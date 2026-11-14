import { describe, expect, test } from "bun:test";

import { fileKey, removeFiles } from "../../src/actions/files";
import type { SiteFolder } from "../../src/records/site";
import { MemoryStore } from "../../src/storage/memory";
import type { ObjectKey } from "../../src/storage/storage";

const FOLDER = "0123456789abcdef" as SiteFolder;

describe("fileKey", () => {
  // Drift: this is the one place a published path becomes a bucket key; a path that passed here and that serving cannot reach, or that climbs out of its version, would be stored for nothing or over another file.
  test.each([
    ["index.html", { ok: true, key: `${FOLDER}/v2/index.html` }],
    ["docs/guide/index.html", { ok: true, key: `${FOLDER}/v2/docs/guide/index.html` }],
    ["100%.css", { ok: true, key: `${FOLDER}/v2/100%.css` }],
    ["docs\\guide.html", { ok: false, refusal: "backslash" }],
    ["\\", { ok: false, refusal: "backslash" }],
    ["..\\..\\index.html", { ok: false, refusal: "backslash" }],
    ["../other/index.html", { ok: false, refusal: "dot-segment" }],
    ["%2e%2e/index.html", { ok: false, refusal: "dot-segment" }],
    ["css//site.css", { ok: false, refusal: "empty-segment" }],
    ["/index.html", { ok: false, refusal: "empty-segment" }],
    ["", { ok: false, refusal: "empty-segment" }],
    ["a\u0000b.html", { ok: false, refusal: "bad-character" }],
    [`${"x".repeat(1024)}.html`, { ok: false, refusal: "too-long" }],
  ])("the path %j of version 2 is %j", (path, checked) => {
    expect<unknown>(fileKey(FOLDER, 2, path)).toEqual(checked);
  });
});

describe("removeFiles", () => {
  // Drift: one request may make only so many store calls; a removal that walked every prefix to its end would pass that limit on a site with many dropped versions.
  test("prefixes are emptied in order while the pages last, and the ones not reached, or not emptied, are named", async () => {
    const store = new MemoryStore();
    const list = store.list.bind(store);
    store.list = (options) => list({ ...options, limit: 2 });
    for (const version of [1, 2, 3]) {
      for (const name of ["a", "b", "c"]) await store.write(`${FOLDER}/v${version}/${name}.html` as ObjectKey, new Uint8Array(1), { contentType: "text/html" });
    }

    const prefixes = [1, 2, 3].map((version) => `${FOLDER}/v${version}/`);
    const left = await removeFiles(store, prefixes, 3);
    const kept = (await list({ prefix: "" })).objects.map((object) => object.key);

    expect([left, kept]).toEqual([[`${FOLDER}/v2/`, `${FOLDER}/v3/`], [`${FOLDER}/v2/c.html`, `${FOLDER}/v3/a.html`, `${FOLDER}/v3/b.html`, `${FOLDER}/v3/c.html`]] as never);
    expect(await removeFiles(store, prefixes, 15)).toEqual([]);
  });
});
