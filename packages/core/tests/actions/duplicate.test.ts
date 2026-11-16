import { describe, expect, spyOn, test } from "bun:test";

import { beginPublish } from "../../src/actions/begin-publish";
import { deleteSite } from "../../src/actions/delete";
import { duplicateSite } from "../../src/actions/duplicate";
import { finishPublish } from "../../src/actions/finish-publish";
import { listSites } from "../../src/actions/list";
import { publishSite } from "../../src/actions/publish";
import { getSite } from "../../src/actions/show";
import { uploadFile } from "../../src/actions/upload-file";
import { uploadKey } from "../../src/actions/uploads";
import { inlineJobs } from "../../src/jobs/inline-jobs";
import { dayOf } from "../../src/records/views";
import type { ObjectKey } from "../../src/storage/storage";
import { BunSqliteDriver } from "../database/support/bun-sqlite-driver";
import { ADMIN, file, hashOf, made, makeWorld, OWNER, STRANGER, type World } from "./support/actions-fixture";

/** How long a test that copies a thousand files may take, in milliseconds: it passes alone in under a second, and a busy machine takes it past the runner's five. */
const COPY_MS = 30_000;

/** The calls a caller made before the action: one, as a caller that read a token did. */
const ASKING = 1;

/** The most calls to the database the action itself may make after a caller's one: the 44 a request of a copy is held to, less the 2 a host may make to start, the caller's own, and the 2 that count the day's listings, which a host makes. */
const OWN_DATABASE_CALLS = 39;

/** The most calls a caller may make before the action and still be let in, and the calls to the database the action may then make itself: the 44, less the 2 of a host's start, the caller's 26, and the 2 that count the day's listings. */
const [EDGE_ASKING, EDGE_CALLS] = [26, 14];

/** The most calls to the store one call of the action may make. */
const STORE_CALLS = 250;

/** A site of five files, each of another media type than the manifest of a copy names. */
const FIVE = [file("index.html", "<p>home</p>"), ...["a", "b", "c", "d"].map((name) => ({ ...file(`docs/${name}.css`, `.${name}{}`), contentType: "text/css" }))];

/** A site of three hundred files: the five, and pages. One call copies 112 of them, so its copy takes three calls. */
const MANY = [...FIVE, ...Array.from({ length: 295 }, (_page, at) => file(`pages/${at}.html`, `<p>${at}</p>`))];

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

    const copied = await duplicateSite(world.install, OWNER, { site: "report" }, ASKING, inlineJobs);
    const named = await duplicateSite(world.install, ADMIN, { site: source, name: "report-draft" }, ASKING, inlineJobs);
    if (!copied.ok || copied.site === null || !named.ok || named.site === null) throw new Error("a copy was refused");

    expect(copied).toMatchObject({
      before: null,
      copy: { copied: 5, files: 5 },
      site: { name: "report", access: "private", public_name: null, title: "Q3 sales (copy)", embeddable: false, expires: "never", live_version: 1, files: 5, created: true },
    });
    expect([copied.site.id === source, copied.site.url, named.site.label]).toEqual([false, `https://report--${copied.site.id}-p-poplin.example.com`, `report-draft--${named.site.id}`]);
    expect(await filesOf(world, await folderOf(world, copied.site.id))).toEqual(await filesOf(world, `${await folderOf(world, source)}/v2`).then((files) => Object.fromEntries(Object.entries(files).map(([path, text]) => [`v1/${path}`, text]))));
    expect(await getSite(world.install, OWNER, source)).toEqual(before);
    expect([(await world.install.database.getSite(copied.site.id))?.owner, (await world.install.database.getSite(named.site.id))?.owner]).toEqual([OWNER.holder, ADMIN.holder]);
    expect(await world.audit()).toEqual(["create", "publish", "create", "duplicate", "create", "duplicate"]);
  });

  // Drift: a copy titled as its source is a second row of the same words in every list; a mark that grew with each copy of a copy, or took a title past the longest one a site holds, would make a title nobody reads or a copy that is refused.
  const titles: readonly { readonly name: string; readonly settings: object; readonly shows: [string | null, boolean] }[] = [
    { name: "a typed title", settings: { title: "Q3 sales", page_title: "Report" }, shows: ["Q3 sales (copy)", true] },
    { name: "the title of its page alone, which the copy holds as a typed one", settings: { page_title: "Report" }, shows: ["Report (copy)", true] },
    { name: "no title, so that the copy shows its name as the site does", settings: {}, shows: [null, false] },
    { name: "a title that ends in the mark already, which takes no second one", settings: { title: "Q3 sales (copy)" }, shows: ["Q3 sales (copy)", true] },
    { name: "the longest title, cut so that the mark fits", settings: { title: "x".repeat(200) }, shows: [`${"x".repeat(193)} (copy)`, true] },
    { name: "a title whose cut ends in a space, which is left out", settings: { title: `${"x".repeat(192)} yz` }, shows: [`${"x".repeat(192)} (copy)`, true] },
    { name: "a title whose cut falls inside a surrogate pair, which is left out whole", settings: { title: `${"x".repeat(192)}\u{1F600}` }, shows: [`${"x".repeat(192)} (copy)`, true] },
  ];

  test.each(titles)("a copy of a site with $name is titled as the site shows itself, with ` (copy)` after it", async ({ settings, shows }) => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report", settings);

    const copied = await duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs);
    if (!copied.ok || copied.site === null) throw new Error("a copy was refused");

    expect([copied.site.title, copied.site.title_typed]).toEqual(shows);
  });

  // Drift: a site too large for one request is copied over several; a copy listed or served before its last file would be a broken site with a working address.
  test("a copy of more files than one call copies is no site until the call that copies the last file, and each call goes on from the upload the one before answered", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: MANY });
    const seen: unknown[] = [];
    let upload: string | undefined;

    for (let calls = 0; calls < 3; calls += 1) {
      const step = await duplicateSite(world.install, OWNER, upload === undefined ? { site: source } : { site: source, upload }, ASKING, inlineJobs);
      if (!step.ok) throw new Error(`a step was refused: ${step.code}`);

      const listed = await listSites(world.install, ADMIN);
      seen.push([step.site?.live_version ?? null, step.copy.copied, listed.ok ? listed.sites.length : -1]);
      upload = step.copy.upload;
    }

    expect(seen).toEqual([[null, 112, 1], [null, 224, 1], [1, 300, 2]]);
    expect(await duplicateSite(world.install, OWNER, { site: source, upload }, ASKING, inlineJobs)).toMatchObject({ ok: true, site: { live_version: 1 }, copy: { copied: 300, files: 300 } });
    expect(await world.audit()).toEqual(["create", "publish", "create", "duplicate"]);
  });

  // Drift: a copy declares its files from a listing, which names no media type; a stand-in longer than the types a publish declared makes the copy's manifest pass the cap its source's fitted under.
  test("a site whose manifest fitted the cap by under the length of a few letters a file is copied, not refused as too large", async () => {
    const world = await makeWorld();
    const sha256 = await hashOf("x");
    const folder = Array.from({ length: 4 }, () => "x".repeat(204)).join("/");
    const images = Array.from({ length: 1_600 }, (_image, at) => ({ path: `${folder}/${String(at).padStart(4, "0")}.png`, size: 1, content_type: "image/png", sha256 }));
    const files = [{ path: "index.html", size: 1, content_type: "text/html", sha256 }, ...images];
    const begun = await beginPublish(world.install, OWNER, { name: "gallery", files });
    if (!begun.ok) throw new Error(`the source was refused: ${begun.code}`);

    // The files go straight into the store. Sent a call each, every one reads the whole manifest again, which was all of this test's time.
    const staged = await world.install.database.getUpload(begun.upload.id);
    if (staged === undefined) throw new Error("the upload was not recorded");

    for (const { path, content_type } of files) {
      const key = uploadKey(staged.upload, path);
      if (key.ok) await world.install.store.write(key.key, new Uint8Array([120]), { contentType: content_type, sha256 });
    }

    const source = await finishPublish(world.install, OWNER, begun.upload.id);
    if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

    expect(await duplicateSite(world.install, OWNER, { site: source.site.id }, ASKING, inlineJobs)).toMatchObject({ ok: true, site: null, copy: { copied: 113, files: 1_601 } });
  });

  // Drift: a host ends a request past 50 calls to the database, some spent before the action, and bounds the store apart. A call that copies more than fits either is never finished; one that counts both as one copies a tenth of what fits.
  test.each([
    [1, 1],
    [300, 3],
    [1_001, 10],
  ])("a copy of %i files is whole after %i calls, none of which makes more than 39 calls to the database or more than 250 to the store", async (count, calls) => {
    const world = await makeWorld();
    const pages = Array.from({ length: count - 1 }, (_page, at) => file(`pages/${at}.html`, "x"));
    const source = await publishSite(world.install, OWNER, { name: "report", files: [file("index.html", "<p>home</p>"), ...pages] });
    if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

    const left = { database: 0, store: 0 };
    const spend = (on: keyof typeof left): void => {
      left[on] -= 1;
      if (left[on] < 0) throw new Error(`the call made more calls to the ${on} than it may`);
    };
    const store = new Proxy(world.install.store, {
      get(target, name) {
        const method: unknown = Reflect.get(target, name);
        if (typeof method !== "function") return method;

        return (...asked: unknown[]): unknown => {
          spend("store");

          return method.apply(target, asked);
        };
      },
    });
    const batch = BunSqliteDriver.prototype.batch;
    const batches = spyOn(BunSqliteDriver.prototype, "batch").mockImplementation(function counted(this: BunSqliteDriver, statements) {
      spend("database");

      return batch.call(this, statements);
    });
    let upload: string | undefined;
    let made = 0;

    try {
      for (let site: unknown = null; site === null; made += 1) {
        Object.assign(left, { database: OWN_DATABASE_CALLS, store: STORE_CALLS });
        const step = await duplicateSite({ ...world.install, store }, OWNER, upload === undefined ? { site: source.site.id } : { site: source.site.id, upload }, ASKING, inlineJobs);
        if (!step.ok) throw new Error(`a step was refused: ${step.code}`);

        upload = step.copy.upload;
        site = step.site;
      }
    } finally {
      batches.mockRestore();
    }

    expect(made).toBe(calls);
  }, COPY_MS);

  // Drift: a caller that reads more before the action than the database's budget leaves room for would make requests a host ends, each after it copied files.
  test("a caller whose own calls leave the database's budget too small is refused before anything is read, and one call fewer is not", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    using batches = spyOn(BunSqliteDriver.prototype, "batch");
    using reads = spyOn(world.install.store, "list");

    await expect(duplicateSite(world.install, OWNER, { site: source }, 27, inlineJobs)).rejects.toThrow(RangeError);
    expect([batches.mock.calls.length, reads.mock.calls.length]).toEqual([0, 0]);
    expect(await duplicateSite(world.install, OWNER, { site: source }, 26, inlineJobs)).toMatchObject({ ok: true, site: { live_version: 1 } });
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

    expect(await duplicateSite(world.install, actor, { site: source, ...asked }, ASKING, inlineJobs)).toEqual(refusal as never);
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

    await expect(duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs)).rejects.toThrow("the store is down");
    expect(await world.keys()).toEqual(keys);
    expect(await duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs)).toMatchObject({ ok: true, site: { live_version: 1 } });
  });

  // Drift: a host bills a write it did not keep, and a copy counts its writes once, when it begins. A later call whose write failed uncounted could be sent again without end, each time one more billed write the day's bound never saw.
  test("a later call of a copy whose write fails counts that write against the day, and the copy stays to be gone on with, from the files that were on their way with it", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: MANY });
    const sources = (await world.keys()).length;
    const begun = await duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs);
    if (!begun.ok) throw new Error("the copy was refused");

    const day = dayOf(world.clock.now);
    const before = (await world.install.database.readStorageWrites(day))?.writes ?? 0;
    spyOn(world.install.store, "write").mockRejectedValueOnce(new Error("the store is down"));

    await expect(duplicateSite(world.install, OWNER, { site: source, upload: begun.copy.upload }, ASKING, inlineJobs)).rejects.toThrow("the store is down");
    const counted = (await world.install.database.readStorageWrites(day))?.writes;
    const held = (await world.keys()).length - sources;
    const next = await duplicateSite(world.install, OWNER, { site: source, upload: begun.copy.upload }, ASKING, inlineJobs);

    // The files that were on their way beside the one that failed are kept, five at most, and no further one was begun.
    expect([counted, held >= 112 && held <= 117, next]).toMatchObject([before + 1, true, { ok: true, copy: { copied: held + 112, files: 300 } }]);
  });

  // Drift: begun one after another while a write fails, the files of a call would each be a billed write of a copy that is given up.
  test("a call whose write fails begins no further file", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: MANY });
    spyOn(world.install.store, "write").mockRejectedValueOnce(new Error("the store is down"));
    using reads = spyOn(world.install.store, "read");

    await expect(duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs)).rejects.toThrow("the store is down");

    expect(reads.mock.calls.length).toBeLessThanOrEqual(6);
  });

  // Drift: six files fail at once, and each counted by itself asks the database ten times more than all counted together: a caller the action let in at the edge of its budget would pass 44.
  test("a call whose six files all fail to be written counts them together and notes the day's limit once, inside the budget of a caller at its edge", async () => {
    // The day's limit is what the two publishes and the copy's 600 writes come to, so the six that fail pass it.
    const world = await makeWorld({ max_storage_writes_per_day: 902 });
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: MANY });
    const day = dayOf(world.clock.now);
    // Every read answers a moment later, so six files are on their way when the first write fails, and every write fails.
    const store = new Proxy(world.install.store, {
      get(target, name) {
        const method: unknown = Reflect.get(target, name);
        if (typeof method !== "function") return method;

        return async (...asked: unknown[]): Promise<unknown> => {
          if (name === "read" || name === "write") await new Promise((resolve) => setTimeout(resolve, 0));

          if (name === "write") throw new Error("the store is down");

          return method.apply(target, asked);
        };
      },
    });
    using batches = spyOn(BunSqliteDriver.prototype, "batch");

    await expect(duplicateSite({ ...world.install, store }, OWNER, { site: source }, EDGE_ASKING, inlineJobs)).rejects.toThrow("the store is down");
    const calls = batches.mock.calls.length;
    const [counted, problems] = [await world.install.database.readStorageWrites(day), await world.install.database.listProblems(day)];

    expect([counted?.writes, problems.map((problem) => problem.kind), calls <= EDGE_CALLS]).toEqual([908, ["writes_limit_reached"], true]);
  });

  // Drift: a billed write that the database did not count would be told as the store's failure alone, and whoever reads the failure would not learn that the day's count is short.
  test("a call whose failed write cannot be counted throws the failure of the count", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    spyOn(world.install.store, "write").mockRejectedValueOnce(new Error("the store is down"));
    spyOn(world.install.database, "addStorageWrites").mockRejectedValueOnce(new Error("the database is down"));

    await expect(duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs)).rejects.toThrow("the database is down");
  });

  // Drift: copied one after another, the files of one call are 224 waits in a row; copied all at once, they pass the connections a host lets one request hold open.
  test("a call copies six files at once, and never more", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: MANY });
    const onTheirWay = { now: 0, most: 0 };
    // A file is on its way from the call that reads it to the end of the call that writes it.
    const store = new Proxy(world.install.store, {
      get(target, name) {
        const method: unknown = Reflect.get(target, name);
        if (typeof method !== "function") return method;

        return async (...asked: unknown[]): Promise<unknown> => {
          if (name === "read") {
            onTheirWay.now += 1;
            onTheirWay.most = Math.max(onTheirWay.most, onTheirWay.now);
            // A store answers later, so the files begun beside this one are on their way by then.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }

          try {
            return await method.apply(target, asked);
          } finally {
            if (name === "write") onTheirWay.now -= 1;
          }
        };
      },
    });

    const begun = await duplicateSite({ ...world.install, store }, OWNER, { site: source }, ASKING, inlineJobs);

    expect([begun.ok && begun.copy.copied, onTheirWay]).toEqual([112, { now: 0, most: 6 }]);
  });

  // Drift: a listing is no snapshot; a version a newer publish is removing lists short, and a copy of what is left would be a site with pages missing.
  test("a source whose live version lists fewer files than its record counts is refused, and nothing is recorded", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    const [gone] = (await world.keys()).filter((key) => key.endsWith("index.html"));
    await world.install.store.delete(gone as ObjectKey);
    const keys = await world.keys();

    expect(await duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs)).toEqual({ ok: false, code: "no_such_version" });
    expect([await world.keys(), (await world.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 })).uploads.map((upload) => upload.plan.kind)]).toEqual([keys, ["create"]]);
  });

  // Drift: the copy's upload is an upload like a publish's; a file sent into it, or a copy begun from a site in the trash, would make a site that is no copy.
  test("a copy takes no file from a caller, a site in the trash is not copied, and a copy whose source stopped keeping the version is given up with its files", async () => {
    const world = await makeWorld({ versions_kept: 1 });
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: MANY });
    const keys = await world.keys();
    const begun = await duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs);
    if (!begun.ok) throw new Error("the copy was refused");

    const sent = await uploadFile(world.install, OWNER, { upload: begun.copy.upload, path: "docs/a.css", body: new Blob([".a{}"]).stream() });
    await publishSite(world.install, OWNER, { site: source, files: [file("index.html", "<p>new</p>")] });
    const lost = await duplicateSite(world.install, OWNER, { site: source, upload: begun.copy.upload }, ASKING, inlineJobs);
    await deleteSite(world.install, OWNER, { site: source });

    expect([sent, lost, await duplicateSite(world.install, OWNER, { site: source }, ASKING, inlineJobs)]).toEqual([
      { ok: false, code: "not_found", about: "upload" },
      { ok: false, code: "no_such_version" },
      { ok: false, code: "in_trash" },
    ]);
    expect([(await world.keys()).length, keys.length, (await world.install.database.readTotals()).sites]).toEqual([1, 300, 1]);
  });
});
