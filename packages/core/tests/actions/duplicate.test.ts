import { describe, expect, spyOn, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { duplicateSite } from "../../src/actions/duplicate";
import { listSites } from "../../src/actions/list";
import { publishSite } from "../../src/actions/publish";
import { getSite } from "../../src/actions/show";
import { uploadFile } from "../../src/actions/upload-file";
import type { ObjectKey } from "../../src/storage/storage";
import { BunSqliteDriver } from "../database/support/bun-sqlite-driver";
import { ADMIN, file, made, makeWorld, OWNER, STRANGER, type World } from "./support/actions-fixture";

/** A site of five files, each of another media type than the manifest of a copy names. */
const FIVE = [file("index.html", "<p>home</p>"), ...["a", "b", "c", "d"].map((name) => ({ ...file(`docs/${name}.css`, `.${name}{}`), contentType: "text/css" }))];

/** Every stored file under a site's folder, as `path -> media type and text`, read from the store. */
async function filesOf(world: World, folder: string): Promise<Record<string, string>> {
  const held: Record<string, string> = {};

  for (const key of (await world.keys()).filter((one) => one.startsWith(`${folder}/`))) {
    const read = await world.install.store.read(key as ObjectKey);
    if (read.kind === "found") held[key.slice(folder.length + 1)] = `${read.info.contentType}: ${await new Response(read.body).text()}`;
  }

  return held;
}

async function folderOf(world: World, id: string): Promise<string> {
  const site = await world.install.database.getSite(id as never);

  return site?.folder ?? "";
}

describe("duplicateSite", () => {
  // Drift: a copy that kept the source's access, public name, or expiry would publish a draft by accident, or vanish with the source's date.
  test("a copy of a public site that expires is private, holds no public name and no expiry, and has its own id, folder, and address with the live version's files", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report", { access: "public", title: "Q3 sales", embeddable: false, expires: "7d" });
    await publishSite(world.install, OWNER, { site: source, files: FIVE });
    const before = await getSite(world.install, OWNER, source);

    const copied = await duplicateSite(world.install, OWNER, { site: "report" });
    const named = await duplicateSite(world.install, ADMIN, { site: source, name: "report-draft" });
    if (!copied.ok || copied.site === null || !named.ok || named.site === null) throw new Error("a copy was refused");

    expect(copied).toMatchObject({
      before: null,
      copy: { copied: 5, files: 5 },
      site: { name: "report", access: "private", public_name: null, title: "Q3 sales", embeddable: false, expires: "never", live_version: 1, files: 5, created: true },
    });
    expect([copied.site.id === source, copied.site.url, named.site.label]).toEqual([false, `https://report--${copied.site.id}-p-poplin.example.com`, `report-draft--${named.site.id}`]);
    expect(await filesOf(world, await folderOf(world, copied.site.id))).toEqual(await filesOf(world, `${await folderOf(world, source)}/v2`).then((files) => Object.fromEntries(Object.entries(files).map(([path, text]) => [`v1/${path}`, text]))));
    expect(await getSite(world.install, OWNER, source)).toEqual(before);
    expect([(await world.install.database.getSite(copied.site.id))?.owner, (await world.install.database.getSite(named.site.id))?.owner]).toEqual([OWNER.holder, ADMIN.holder]);
    expect(await world.audit()).toEqual(["create", "publish", "create", "duplicate", "create", "duplicate"]);
  });

  // Drift: a site too large for one request is copied over several; a copy listed or served before its last file would be a broken site with a working address.
  test("a copy made a file a call is no site until the call that copies the last file, and each call goes on from the upload the one before answered", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: FIVE });
    const seen: unknown[] = [];
    let upload: string | undefined;

    for (let calls = 0; calls < 5; calls += 1) {
      const step = await duplicateSite(world.install, OWNER, upload === undefined ? { site: source } : { site: source, upload }, 1);
      if (!step.ok) throw new Error(`a step was refused: ${step.code}`);

      const listed = await listSites(world.install, ADMIN);
      seen.push([step.site?.live_version ?? null, step.copy.copied, listed.ok ? listed.sites.length : -1]);
      upload = step.copy.upload;
    }

    expect(seen).toEqual([[null, 1, 1], [null, 2, 1], [null, 3, 1], [null, 4, 1], [1, 5, 2]]);
    expect(await duplicateSite(world.install, OWNER, { site: source, upload }, 1)).toMatchObject({ ok: true, site: { live_version: 1 }, copy: { copied: 5, files: 5 } });
    expect(await world.audit()).toEqual(["create", "publish", "create", "duplicate"]);
  });

  // Drift: a copy declares its files from a listing, which names no media type; a stand-in longer than the types a publish declared makes the copy's manifest pass the cap its source's fitted under.
  test("a site whose manifest fitted the cap by under the length of a few letters a file is copied, not refused as too large", async () => {
    const world = await makeWorld();
    const folder = Array.from({ length: 4 }, () => "x".repeat(218)).join("/");
    const images = Array.from({ length: 1_600 }, (_image, at) => ({ ...file(`${folder}/${String(at).padStart(4, "0")}.png`, "x"), contentType: "image/png" }));
    const source = await publishSite(world.install, OWNER, { name: "gallery", files: [file("index.html", "<p>home</p>"), ...images] });
    if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

    expect(await duplicateSite(world.install, OWNER, { site: source.site.id }, 1)).toMatchObject({ ok: true, site: null, copy: { copied: 1, files: 1_601 } });
  });

  // Drift: a host ends a request that makes more than 50 calls to the database and the store; a call that copies more files than fit leaves a copy nobody can finish.
  test.each([
    [1, 1],
    [300, 19],
    [1_001, 49],
  ])("a copy of %i files is whole after %i calls, none of which makes more than 50 calls to the database and the store", async (count, calls) => {
    const world = await makeWorld();
    const pages = Array.from({ length: count - 1 }, (_page, at) => file(`pages/${at}.html`, "x"));
    const source = await publishSite(world.install, OWNER, { name: "report", files: [file("index.html", "<p>home</p>"), ...pages] });
    if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

    const budget = { left: 0 };
    const spend = (): void => {
      budget.left -= 1;
      if (budget.left < 0) throw new Error("the call made more than 50 calls");
    };
    const store = new Proxy(world.install.store, {
      get(target, name) {
        const method: unknown = Reflect.get(target, name);
        if (typeof method !== "function") return method;

        return (...asked: unknown[]): unknown => {
          spend();

          return method.apply(target, asked);
        };
      },
    });
    const batch = BunSqliteDriver.prototype.batch;
    const batches = spyOn(BunSqliteDriver.prototype, "batch").mockImplementation(function counted(this: BunSqliteDriver, statements) {
      spend();

      return batch.call(this, statements);
    });
    let upload: string | undefined;
    let made = 0;

    try {
      for (let site: unknown = null; site === null; made += 1) {
        budget.left = 50;
        const step = await duplicateSite({ ...world.install, store }, OWNER, upload === undefined ? { site: source.site.id } : { site: source.site.id, upload });
        if (!step.ok) throw new Error(`a step was refused: ${step.code}`);

        upload = step.copy.upload;
        site = step.site;
      }
    } finally {
      batches.mockRestore();
    }

    expect(made).toBe(calls);
  });

  // Drift: a duplicate is a new site made from another's files, so it must pass every door a publish and a read pass: ownership, the trash, and the install's limits.
  test.each([
    ["a publisher who does not own the site", {}, STRANGER, {}, { ok: false, code: "not_found" }],
    ["an install that holds as many sites as it may", { max_sites: 1 as const }, OWNER, {}, { ok: false, code: "too_many_sites", about: "max_sites" }],
    ["an install with no room for the bytes", { max_total_size: { count: 20, unit: "B" as const } }, OWNER, {}, { ok: false, code: "too_large", about: "max_total_size" }],
    ["a name that is none", {}, OWNER, { name: "Not A Name" }, { ok: false, code: "bad_name", about: "name" }],
    ["a name beside an upload", {}, OWNER, { name: "draft", upload: "0000000000000000" }, { ok: false, code: "bad_argument", about: "name" }],
    ["an upload that is no copy of this site", {}, OWNER, { upload: "0000000000000000" }, { ok: false, code: "not_found", about: "upload" }],
  ])("%s is refused, and nothing is left behind", async (_case, settings, actor, asked, refusal) => {
    const world = await makeWorld(settings);
    const source = await made(world, OWNER, "report");
    const keys = await world.keys();

    expect(await duplicateSite(world.install, actor, { site: source, ...asked })).toEqual(refusal as never);
    expect([await world.keys(), await world.audit()]).toEqual([keys, ["create"]]);
  });

  // Drift: a call that throws answers no upload id, so nobody could go on with the copy it began; left pending, it would hold a place under `max_sites` for a day.
  test.each([
    ["the write of the second file", (world: World) => Object.assign(world.faults, { failWrite: 4 })],
    [
      "the listing that finishing reads",
      (world: World) => {
        const list = world.install.store.list.bind(world.install.store);
        spyOn(world.install.store, "list").mockImplementationOnce(list).mockRejectedValueOnce(new Error("the store is down"));
      },
    ],
  ])("a first call that fails at %s leaves no upload and no file behind, so the next one makes the copy", async (_case, breakStore) => {
    const world = await makeWorld({ max_sites: 2 });
    const source = await made(world, OWNER, "report");
    const keys = await world.keys();
    breakStore(world);

    await expect(duplicateSite(world.install, OWNER, { site: source })).rejects.toThrow("the store is down");
    expect(await world.keys()).toEqual(keys);
    expect(await duplicateSite(world.install, OWNER, { site: source })).toMatchObject({ ok: true, site: { live_version: 1 } });
  });

  // Drift: a listing is no snapshot; a version a newer publish is removing lists short, and a copy of what is left would be a site with pages missing.
  test("a source whose live version lists fewer files than its record counts is refused, and nothing is recorded", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    const [gone] = (await world.keys()).filter((key) => key.endsWith("index.html"));
    await world.install.store.delete(gone as ObjectKey);
    const keys = await world.keys();

    expect(await duplicateSite(world.install, OWNER, { site: source })).toEqual({ ok: false, code: "no_such_version" });
    expect([await world.keys(), (await world.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 })).uploads.map((upload) => upload.plan.kind)]).toEqual([keys, ["create"]]);
  });

  // Drift: the copy's upload is an upload like a publish's; a file sent into it, or a copy begun from a site in the trash, would make a site that is no copy.
  test("a copy takes no file from a caller, a site in the trash is not copied, and a copy whose source stopped keeping the version is given up with its files", async () => {
    const world = await makeWorld({ versions_kept: 1 });
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: FIVE });
    const keys = await world.keys();
    const begun = await duplicateSite(world.install, OWNER, { site: source }, 1);
    if (!begun.ok) throw new Error("the copy was refused");

    const sent = await uploadFile(world.install, OWNER, { upload: begun.copy.upload, path: "docs/a.css", body: new Blob([".a{}"]).stream() });
    await publishSite(world.install, OWNER, { site: source, files: [file("index.html", "<p>new</p>")] });
    const lost = await duplicateSite(world.install, OWNER, { site: source, upload: begun.copy.upload }, 1);
    await deleteSite(world.install, OWNER, { site: source });

    expect([sent, lost, await duplicateSite(world.install, OWNER, { site: source })]).toEqual([
      { ok: false, code: "not_found", about: "upload" },
      { ok: false, code: "no_such_version" },
      { ok: false, code: "in_trash" },
    ]);
    expect([(await world.keys()).length, keys.length, (await world.install.database.readTotals()).sites]).toEqual([1, 5, 1]);
  });
});
