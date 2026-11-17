import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../../src/actions/sites/delete";
import { exportFile, exportFiles, exportSettings, exportSite, exportSites } from "../../../src/actions/backup/export";
import { publishSite } from "../../../src/actions/publish/publish";
import { rollbackSite } from "../../../src/actions/sites/rollback";
import { ADMIN, file, made, makeWorld, OWNER, pages, STRANGER, type World } from "../support/actions-fixture";

/** A site that keeps three versions and is live at its second; answers its id. */
async function manual(world: World): Promise<string> {
  const id = await made(world, OWNER, "manual");
  for (const text of ["manual v2", "manual v3"]) await publishSite(world.install, OWNER, { site: id, files: pages(text) });

  await rollbackSite(world.install, ADMIN, { site: id, version: 2 });

  return id;
}

async function text(read: Awaited<ReturnType<typeof exportFile>>): Promise<unknown> {
  return read.ok ? [await new Response(read.body).text(), read.size, read.content_type] : read;
}

describe("exportSites", () => {
  // Drift: a backup is read a page at a time; a page that began where the last ended, or one site short, would restore an install with a site twice or missing, and nobody counts them.
  test("every site comes once over the pages, the trash included, each with its live version alone unless all are asked for", async () => {
    const world = await makeWorld();
    const ids = [await manual(world), await made(world, STRANGER, "notes", { access: "unlisted" }), await made(world, ADMIN, "docs", { access: "public" })];
    await deleteSite(world.install, ADMIN, { site: ids[1] ?? "" });

    const seen: unknown[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await exportSites(world.install, ADMIN, { limit: 2, after: after as never });
      if (!page.ok) throw new Error(`the export was refused: ${page.code}`);

      seen.push(...page.sites.map((site) => [site.id, site.state, site.live_version, site.versions.map((version) => version.number), site.access]));
      after = page.next;
      pages += 1;
    } while (after !== undefined);

    const whole = await exportSites(world.install, ADMIN, { all_versions: true });
    const one = await exportSite(world.install, ADMIN, { site: ids[0] ?? "", all_versions: true });

    expect([pages, [...seen].sort()]).toEqual([2, [[ids[0], "live", 2, [2], "private"], [ids[1], "trash", 1, [1], "unlisted"], [ids[2], "live", 1, [1], "public"]].sort()]);
    expect(whole.ok && whole.sites.map((site) => site.versions.length).sort()).toEqual([1, 1, 3]);
    expect(one.ok && [one.format, one.site.versions.map((version) => [version.number, version.bytes, version.files]), one.site.owner]).toEqual([1, [[1, 15, 2], [2, 15, 2], [3, 15, 2]], OWNER.holder]);
  });

  // Drift: an export hands out every site's record and files at once; a publisher that reached it would read what its own token is kept from one site at a time.
  test("no export answers a publisher, even about its own site", async () => {
    const world = await makeWorld();
    const site = await made(world, OWNER, "report");

    const answers = [
      await exportSettings(world.install, OWNER),
      await exportSites(world.install, OWNER),
      await exportSite(world.install, OWNER, { site }),
      await exportFiles(world.install, OWNER, { site, version: 1 }),
      await exportFile(world.install, OWNER, { site, version: 1, path: "index.html" }),
    ];

    expect(answers).toEqual(Array.from({ length: 5 }, () => ({ ok: false, code: "not_allowed" })));
  });

});

describe("exportFiles", () => {
  // Drift: a version can hold ten thousand files and one request lists a thousand; a cursor that skipped or repeated a file would write a backup that fails its own import.
  test("the files of one kept version come a page at a time, each once, with the path it has in the version", async () => {
    const world = await makeWorld();
    const published = await publishSite(world.install, OWNER, { name: "report", files: [file("index.html", "<h1>report</h1>"), file("a/b.css", "b{}"), file("a/c.css", "c{}{}"), file("z.txt", "")] });
    if (!published.ok) throw new Error(`the fixture site was refused: ${published.code}`);

    const site = published.site.id;
    const seen: unknown[] = [];
    let cursor: string | undefined;
    let calls = 0;
    do {
      const page = await exportFiles(world.install, ADMIN, { site, version: 1, limit: 3, cursor });
      if (!page.ok) throw new Error(`the listing was refused: ${page.code}`);

      seen.push(...page.files);
      cursor = page.next;
      calls += 1;
    } while (cursor !== undefined);

    expect([calls, seen]).toEqual([2, [{ path: "a/b.css", size: 3 }, { path: "a/c.css", size: 5 }, { path: "index.html", size: 15 }, { path: "z.txt", size: 0 }]]);
    expect([await exportFiles(world.install, ADMIN, { site, version: 2 }), await exportFiles(world.install, ADMIN, { site, version: 1, limit: 1001 })]).toEqual([
      { ok: false, code: "no_such_version" },
      { ok: false, code: "bad_argument", about: "limit" },
    ]);
  });
});

describe("exportFile", () => {
  // Drift: this is the one action that reads a stored file for a caller; a key that took the caller's text as it came would read another version, another site, or a pending upload.
  test.each([
    ["a file of the live version", { version: 2, path: "index.html" }, ["manual v2", 9, "text/html"]],
    ["a file of an older kept version", { version: 1, path: "css/site.css" }, ["body{}", 6, "text/html"]],
    ["a version the site does not keep", { version: 4, path: "index.html" }, { ok: false, code: "no_such_version" }],
    ["a version that is no whole number", { version: 1.5, path: "index.html" }, { ok: false, code: "no_such_version" }],
    ["a path that climbs to another version", { version: 2, path: "../v3/index.html" }, { ok: false, code: "not_found", about: "path" }],
    ["a path that climbs to another site", { version: 2, path: "../../other/v9/index.html" }, { ok: false, code: "not_found", about: "path" }],
    ["a path with a backslash", { version: 2, path: "css\\site.css" }, { ok: false, code: "not_found", about: "path" }],
    ["a folder, not a file", { version: 2, path: "css" }, { ok: false, code: "not_found", about: "path" }],
    ["no path", { version: 2, path: "" }, { ok: false, code: "not_found", about: "path" }],
  ] as const)("%s", async (_what, asked, answer) => {
    const world = await makeWorld();
    const site = await manual(world);

    expect(await text(await exportFile(world.install, ADMIN, { site, ...asked }))).toEqual(answer);
  });
});
