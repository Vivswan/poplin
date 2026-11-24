import { describe, expect, spyOn, test } from "bun:test";

import { beginPublish } from "../../../src/actions/publish/begin-publish";
import { publishSite } from "../../../src/actions/publish/publish";
import { checkFilePath, fileKey, listFolder, removeFiles } from "../../../src/actions/sites/files";
import type { SiteFolder } from "../../../src/records/site";
import { MemoryStore } from "../../../src/storage/memory";
import type { ListPage, ObjectKey } from "../../../src/storage/storage";
import { ADMIN, file, makeWorld, OWNER, PAGE_SHA256, STRANGER, type World } from "../support/actions-fixture";

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

describe("listFolder", () => {
  /** A site whose first version holds folders in folders, and a file and a folder of one name; its second version, the live one, holds other files. Answers its id. */
  async function nested(world: World): Promise<string> {
    const first = ["index.html", "about", "about/team.html", "assets/app.css", "assets/img/logo.svg", "assets/img/photo.jpg", "z.txt"];
    const published = await publishSite(world.install, OWNER, { name: "report", files: first.map((path) => file(path, path)) });
    if (!published.ok) throw new Error(`the fixture site was refused: ${published.code}`);

    const again = await publishSite(world.install, OWNER, { site: published.site.id, files: [file("index.html", "v2"), file("only-in-v2.txt", "x")] });
    if (!again.ok) throw new Error(`the fixture's second version was refused: ${again.code}`);

    return published.site.id;
  }

  // Drift: the dashboard shows a site's files as a tree read one folder at a time; a page that held what lies inside a folder, named a folder twice, lost a row at a page's edge, or cost more than one listing
  // would show a tree the site does not serve, or spend the day's listings on one press.
  test("a folder of a kept version comes a page at a time, one listing each: the folders and the files right in it, each once by its path in the version, with the count of the whole version", async () => {
    const world = await makeWorld();
    const site = await nested(world);
    const lists = spyOn(world.install.store, "list");
    const seen: { folders: string[]; files: unknown[]; totals: number[] } = { folders: [], files: [], totals: [] };
    let cursor: string | undefined;

    do {
      const page = await listFolder(world.install, OWNER, { site, version: 1, limit: 2, cursor });
      if (!page.ok) throw new Error(`the listing was refused: ${page.code}`);

      seen.folders.push(...page.folders);
      seen.files.push(...page.files);
      seen.totals.push(page.total);
      cursor = page.next;
      // Five rows are three pages of two: a walk that went on past them would never end on a cursor that came back.
    } while (cursor !== undefined && seen.totals.length < 4);

    expect([seen, lists.mock.calls.length]).toEqual([
      { folders: ["about", "assets"], files: [{ path: "about", size: 5 }, { path: "index.html", size: 10 }, { path: "z.txt", size: 5 }], totals: [7, 7, 7] },
      3,
    ]);
  });

  // Drift: a folder inside a folder would be listed from the version's top, or with paths counted from itself, so its files would link to nothing; or the tree of the live version would show the files of an older one.
  test.each([
    ["a folder of the first version", { version: 1, folder: "assets" }, { folders: ["assets/img"], files: [{ path: "assets/app.css", size: 14 }], total: 7 }],
    ["a folder inside that folder", { version: 1, folder: "assets/img" }, { folders: [], files: [{ path: "assets/img/logo.svg", size: 19 }, { path: "assets/img/photo.jpg", size: 20 }], total: 7 }],
    ["the folder that shares a file's name", { version: 1, folder: "about" }, { folders: [], files: [{ path: "about/team.html", size: 15 }], total: 7 }],
    ["the top of the live version", { version: 2 }, { folders: [], files: [{ path: "index.html", size: 2 }, { path: "only-in-v2.txt", size: 1 }], total: 2 }],
    ["a folder the version does not hold", { version: 2, folder: "assets" }, { folders: [], files: [], total: 2 }],
  ])("%s is listed by the paths its files have in the version, for an admin as for the owner", async (_what, asked, listed) => {
    const world = await makeWorld();
    const site = await nested(world);

    expect([await listFolder(world.install, OWNER, { site, ...asked }), await listFolder(world.install, ADMIN, { site, ...asked })]).toEqual([
      { ok: true, ...listed },
      { ok: true, ...listed },
    ]);
  });

  // Drift: a folder's path is the caller's text; one that was put into the prefix as it came would list another version, another site, or the whole bucket.
  test.each([
    ["a path that climbs to another version", OWNER, { version: 1, folder: "../v2" }, { ok: false, code: "bad_argument", about: "folder" }],
    ["a path that ends in a slash", OWNER, { version: 1, folder: "assets/" }, { ok: false, code: "bad_argument", about: "folder" }],
    ["a path with a backslash", OWNER, { version: 1, folder: "assets\\img" }, { ok: false, code: "bad_argument", about: "folder" }],
    ["a version the site does not keep", OWNER, { version: 3 }, { ok: false, code: "no_such_version" }],
    ["a page of more than a listing takes", OWNER, { version: 1, limit: 1001 }, { ok: false, code: "bad_argument", about: "limit" }],
    ["a publisher that does not own the site", STRANGER, { version: 1 }, { ok: false, code: "not_found" }],
  ] as const)("%s is refused, and nothing is listed", async (_what, actor, asked, refusal) => {
    const world = await makeWorld();
    const site = await nested(world);
    const lists = spyOn(world.install.store, "list");

    expect<unknown>([await listFolder(world.install, actor, { site, ...asked }), lists.mock.calls.length]).toEqual([refusal, 0]);
  });

  // Drift: the dashboard keeps a folder's pages while it stays open; the `next` of one folder's page, or of one version's, taken for another's would be read on at a place that listing never held: rows left out, or listed twice.
  test.each([
    ["another folder of the version", { version: 1, folder: "assets" }],
    ["the same folder of another version", { version: 2 }],
  ] as const)("the next of a page is no cursor of %s: it is refused, and nothing is listed", async (_what, asked) => {
    const world = await makeWorld();
    const site = await nested(world);
    const page = await listFolder(world.install, OWNER, { site, version: 1, limit: 2 });
    if (!page.ok || page.next === undefined) throw new Error("the fixture's first page names no following one");

    const lists = spyOn(world.install.store, "list");

    expect<unknown>([await listFolder(world.install, OWNER, { site, ...asked, limit: 2, cursor: page.next }), lists.mock.calls.length]).toEqual([{ ok: false, code: "bad_argument", about: "cursor" }, 0]);
  });

  // Drift: a cursor cut where the store's own begins would start the listing over: the same page again under the same `next`, for as long as it is asked.
  test("the next of a page without the store's own cursor after it is refused, and nothing more is listed", async () => {
    const world = await makeWorld();
    const site = await nested(world);
    const lists = spyOn(world.install.store, "list");
    const page = await listFolder(world.install, OWNER, { site, version: 1, limit: 2 });
    const stored = (await lists.mock.results[0]?.value) as ListPage | undefined;
    if (!page.ok || page.next === undefined || stored?.more !== true) throw new Error("the fixture's first page names no following one");

    expect<unknown>([await listFolder(world.install, OWNER, { site, version: 1, limit: 2, cursor: page.next.slice(0, -stored.cursor.length) }), lists.mock.calls.length]).toEqual([
      { ok: false, code: "bad_argument", about: "cursor" },
      1,
    ]);
  });
});
