import { describe, expect, test } from "bun:test";

import { beginPublish } from "../../src/actions/begin-publish";
import { checkFilePath, fileKey, removeFiles } from "../../src/actions/files";
import type { SiteFolder } from "../../src/records/site";
import { MemoryStore } from "../../src/storage/memory";
import type { ObjectKey } from "../../src/storage/storage";
import { makeWorld, OWNER, PAGE_SHA256 } from "./support/actions-fixture";

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

describe("checkFilePath", () => {
  // Drift: whatever lists files for a publish asks this, and the publish asks it again; an answer that differed from the publish's own would list a file in a dry run and refuse it on the real run, or the other way round.
  test.each([
    ["index.html", { ok: true }],
    ["docs/guide/index.html", { ok: true }],
    ["notes\\draft.txt", { ok: false, refusal: "backslash" }],
    ["../other/index.html", { ok: false, refusal: "dot-segment" }],
    ["", { ok: false, refusal: "empty-segment" }],
    ["a".repeat(989), { ok: true }],
    ["a".repeat(990), { ok: false, refusal: "too-long" }],
  ])("the path %j is %j, and a publish that declares it agrees", async (path, checked) => {
    const world = await makeWorld();
    const files = [...new Set(["index.html", path])].map((declared) => ({ path: declared, size: 1, content_type: "text/html", sha256: PAGE_SHA256 }));
    const begun = await beginPublish(world.install, OWNER, { name: "report", files });

    expect<unknown>([checkFilePath(path), begun.ok ? "taken" : begun]).toEqual([checked, checked.ok ? "taken" : { ok: false, code: "bad_path", about: path }]);
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
