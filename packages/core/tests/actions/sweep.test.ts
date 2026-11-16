import { describe, expect, spyOn, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { cancelCopy, duplicateSite } from "../../src/actions/duplicate";
import { listSites } from "../../src/actions/list";
import { restoreSite } from "../../src/actions/restore";
import { updateSite } from "../../src/actions/set";
import { getSite } from "../../src/actions/show";
import { sweepExpired } from "../../src/actions/sweep";
import { abandonPublish } from "../../src/actions/abandon-publish";
import { beginPublish } from "../../src/actions/begin-publish";
import { publishSite } from "../../src/actions/publish";
import { uploadFile } from "../../src/actions/upload-file";
import type { Jobs } from "../../src/jobs/jobs";
import { dayOf } from "../../src/records/views";
import { ADMIN, DAY, file, made, makeWorld, NOW, OWNER, PAGE_SHA256, type World } from "./support/actions-fixture";

/** The milliseconds of one hour. */
const HOUR = 3_600_000;

/** The one file of a fixture upload, as its manifest declares it. */
const PAGE = { path: "index.html", size: 4, content_type: "text/html", sha256: PAGE_SHA256 };

/** The files one removal takes from a folder whose list pages hold one object each. */
const ONE_REMOVAL = 15;

/** A host that runs jobs by itself, and runs none: every copy it starts is left as its first call left it. */
const SILENT_JOBS: Jobs = { background: true, start: async () => undefined, stop: async () => undefined };

/** Begin a publish of one four-byte page and send it; answers the upload's id. */
async function staged(world: World, asked: object): Promise<string> {
  const begun = await beginPublish(world.install, OWNER, { ...asked, files: [PAGE] });
  if (!begun.ok) throw new Error(`the fixture upload was refused: ${begun.code}`);

  await uploadFile(world.install, OWNER, { upload: begun.upload.id, path: PAGE.path, body: new Blob(["page"]).stream() });

  return begun.upload.id;
}

/** Run a whole walk, step after step, and answer what each step did to the sites. The last two steps are the ones over the uploads and over the leftovers. */
async function walk(world: World, limit: number): Promise<unknown[]> {
  const steps: unknown[] = [];
  let from: Parameters<typeof sweepExpired>[2]["from"];

  do {
    const step = await sweepExpired(world.install, ADMIN, { limit, from });
    if (!step.ok) throw new Error(`the sweep was refused: ${step.code}`);

    steps.push([step.trashed, step.deleted, step.left]);
    from = step.next;
  } while (from !== undefined);

  return steps;
}

/** Make every list page of the store hold one object, so one removal, which walks 15 pages, takes `ONE_REMOVAL` files from a folder. */
function shortPages(world: World): void {
  const list = world.install.store.list.bind(world.install.store);
  spyOn(world.install.store, "list").mockImplementation((options) => list({ ...options, limit: 1 }));
}

/** Publish a site of `files` pages; answers its id. */
async function sized(world: World, name: string, files: number): Promise<string> {
  const pages = Array.from({ length: files }, (_, index) => file(index === 0 ? "index.html" : `page-${index}.html`, "page"));
  const published = await publishSite(world.install, OWNER, { files: pages, name });
  if (!published.ok) throw new Error(`the fixture site was refused: ${published.code}`);

  return published.site.id;
}

describe("sweepExpired", () => {
  // Drift: one removal reaches a bounded number of files; a site with more, whose row is gone, would keep the rest in the bucket for good unless a later walk came back for them.
  test("a site removed with more files than one removal reaches is finished by the walks after it, and the answer names its prefix until then", async () => {
    const world = await makeWorld({ trash_days: 1 });
    const big = await sized(world, "big", 2 * ONE_REMOVAL + 5);
    const old = await sized(world, "old", ONE_REMOVAL + 5);
    const kept = await sized(world, "kept", 3);
    await deleteSite(world.install, OWNER, { site: old });
    shortPages(world);
    const folderOf = async (count: number): Promise<string> => {
      const folders = (await world.keys()).map((key) => key.split("/")[0] ?? "");

      return `${folders.find((folder) => folders.filter((other) => other === folder).length === count)}/`;
    };
    const [bigPrefix, oldPrefix] = [await folderOf(2 * ONE_REMOVAL + 5), await folderOf(ONE_REMOVAL + 5)];

    const removed = await deleteSite(world.install, OWNER, { site: big, no_trash: true });
    const afterDelete = (await world.keys()).length;
    world.clock.now = NOW + DAY;
    const walks = [await walk(world, 10), await walk(world, 10), await walk(world, 10)];
    const leftovers = await world.install.database.listLeftovers({ limit: 10 });

    expect([removed.ok && removed.left, afterDelete]).toEqual([[bigPrefix], ONE_REMOVAL + 5 + ONE_REMOVAL + 5 + 3]);
    expect(walks).toEqual([
      [
        [0, 0, []],
        [0, 1, [oldPrefix]],
        [0, 0, []],
        [0, 0, [bigPrefix]],
      ],
      [
        [0, 0, []],
        [0, 0, []],
        [0, 0, []],
        [0, 0, []],
      ],
      [
        [0, 0, []],
        [0, 0, []],
        [0, 0, []],
        [0, 0, []],
      ],
    ]);
    expect([leftovers, (await world.keys()).length, await getSite(world.install, ADMIN, kept)]).toMatchObject([{ folders: [] }, 3, { ok: true }]);
  });

  // Drift: a store that is down when a site is removed leaves every file behind; the folder is remembered with the row's removal, so the next walk needs no answer of the failed one.
  test("files a failed removal left are removed by the next walk, a step of leftovers takes them a page at a time, and each is counted once it is empty", async () => {
    const world = await makeWorld();
    const sites = [await sized(world, "one", 2), await sized(world, "two", 2), await sized(world, "three", 2)];
    world.faults.failRemoval = true;
    for (const site of sites) await deleteSite(world.install, OWNER, { site, no_trash: true });

    const down = await sweepExpired(world.install, ADMIN, { limit: 10, from: { leftovers: true } });
    world.faults.failRemoval = false;
    const first = await sweepExpired(world.install, ADMIN, { limit: 2, from: { leftovers: true } });
    const rest = await sweepExpired(world.install, ADMIN, { limit: 2, from: first.ok ? first.next : undefined });
    const again = await sweepExpired(world.install, ADMIN, { limit: 2, from: { leftovers: true } });

    expect(down).toMatchObject({ ok: true, emptied: 0, left: [expect.any(String), expect.any(String), expect.any(String)] });
    expect([first, rest, again]).toMatchObject([
      { ok: true, emptied: 2, left: [], next: { leftovers: true } },
      { ok: true, emptied: 1, left: [] },
      { ok: true, emptied: 0, left: [] },
    ]);
    expect([rest.ok && rest.next, again.ok && again.next, await world.keys()]).toEqual([undefined, undefined, []]);
  });

  // Drift: the sweep runs on a schedule with nobody watching; one that was not idempotent would trash or delete a little more on every run.
  test("a sweep trashes what has expired and deletes for good what has sat out its days in the trash, and a second sweep at once does nothing", async () => {
    const world = await makeWorld({ trash_days: 2 });
    const lasting = await made(world, OWNER, "lasting");
    const expiring = await made(world, OWNER, "expiring", { expires: "1d" });
    const later = await made(world, OWNER, "later", { expires: "5d" });
    const old = await made(world, OWNER, "old");
    const fresh = await made(world, OWNER, "fresh");
    await deleteSite(world.install, OWNER, { site: old });
    world.clock.now = NOW + DAY;
    await deleteSite(world.install, OWNER, { site: fresh });
    world.clock.now = NOW + 2 * DAY;

    const first = await walk(world, 10);
    const [keys, audit] = [await world.keys(), await world.audit()];
    const second = await walk(world, 10);

    expect([first, second]).toEqual([
      [
        [1, 0, []],
        [0, 1, []],
        [0, 0, []],
        [0, 0, []],
      ],
      [
        [0, 0, []],
        [0, 0, []],
        [0, 0, []],
        [0, 0, []],
      ],
    ]);
    expect([await world.keys(), await world.audit()]).toEqual([keys, audit]);
    expect(audit.slice(-2)).toEqual(["trash", "delete"]);
    expect(keys.length).toBe(8);
    expect([
      await getSite(world.install, ADMIN, lasting),
      await getSite(world.install, ADMIN, expiring),
      await getSite(world.install, ADMIN, later),
      await getSite(world.install, ADMIN, old),
      await getSite(world.install, ADMIN, fresh),
    ]).toMatchObject([
      { site: { state: "live" } },
      { site: { state: "trash", gone_on: NOW + 4 * DAY } },
      { site: { state: "live" } },
      { ok: false, code: "not_found" },
      { site: { state: "trash", gone_on: NOW + 3 * DAY } },
    ]);
  });

  // Drift: one Worker request may make few calls; a step that looked at more sites than its limit, or a `next` that skipped one, would leave the walk unfinished for good.
  test("a step takes no more than `limit` due sites, and following `next` reaches every expired site and all that sat out the trash", async () => {
    const world = await makeWorld({ trash_days: 1 });
    for (const [at, name] of ["one", "two", "three"].entries()) {
      world.clock.now = NOW + at;
      await made(world, OWNER, name, { expires: "1d" });
    }
    const old = await made(world, OWNER, "old");
    await deleteSite(world.install, OWNER, { site: old });
    world.clock.now = NOW + DAY + 2;

    const steps = await walk(world, 2);
    const trash = await listSites(world.install, ADMIN, { trash: true });

    expect(steps).toEqual([
      [2, 0, []],
      [1, 0, []],
      [0, 1, []],
      [0, 0, []],
      [0, 0, []],
    ]);
    expect(trash).toMatchObject({ ok: true, sites: [{ state: "trash" }, { state: "trash" }, { state: "trash" }] });
    expect(await getSite(world.install, ADMIN, old)).toEqual({ ok: false, code: "not_found" });
  });

  // Drift: a step acts on a listing that is a moment old; one that trusted it would delete for good a site its owner had just restored.
  test("a site restored or given a later expiry after the step listed it is left as its owner set it", async () => {
    const world = await makeWorld({ trash_days: 1 });
    const renewed = await made(world, OWNER, "renewed", { expires: "1d" });
    const restored = await made(world, OWNER, "restored");
    await deleteSite(world.install, OWNER, { site: restored });
    world.clock.now = NOW + 2 * DAY;
    const list = world.install.database.listDueSites.bind(world.install.database);
    const listed: number[] = [];
    spyOn(world.install.database, "listDueSites").mockImplementation(async (due, limit) => {
      const ids = await list(due, limit);
      listed.push(ids.length);
      if ("trashedBy" in due) await restoreSite(world.install, OWNER, restored);
      if ("expiredBy" in due) await updateSite(world.install, OWNER, { site: renewed, expires: "never" });

      return ids;
    });

    expect(await walk(world, 10)).toEqual([
      [0, 0, []],
      [0, 0, []],
      [0, 0, []],
      [0, 0, []],
    ]);
    expect(listed).toEqual([1, 1]);
    expect([await getSite(world.install, OWNER, renewed), await getSite(world.install, OWNER, restored)]).toMatchObject([
      { site: { state: "live", expires: "never" } },
      { site: { state: "live" } },
    ]);
    expect((await world.keys()).length).toBe(4);
  });

  // Drift: a client that broke off leaves files in the bucket under no site; nothing but the sweep ever removes them, and a sweep that came early would take files still being sent.
  test("an upload nobody finished goes with its files once 25 hours have passed and not before, and a finished upload's record goes while its site's files stay", async () => {
    const world = await makeWorld({ versions_kept: 1 });
    const site = await made(world, OWNER, "report");
    await staged(world, { name: "draft" });
    await staged(world, { site });
    await abandonPublish(world.install, OWNER, await staged(world, { site }));
    await publishSite(world.install, OWNER, { files: [file("index.html", "live")], site });
    const before = await world.keys();
    const uploads = async (): Promise<number> => (await world.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 100 })).uploads.length;

    world.clock.now = NOW + 25 * HOUR;
    const early = [await sweepExpired(world.install, ADMIN, { limit: 10, from: { uploads: true } }), await uploads()];
    world.clock.now = NOW + 25 * HOUR + 1;
    world.faults.failRemoval = true;
    const failed = await sweepExpired(world.install, ADMIN, { limit: 10, from: { uploads: true } });
    world.faults.failRemoval = false;
    const first = await sweepExpired(world.install, ADMIN, { limit: 2, from: { uploads: true } });
    const rest = await sweepExpired(world.install, ADMIN, { limit: 10, from: first.ok ? first.next : undefined });

    expect(early).toMatchObject([{ ok: true, uploads: 0, left: [] }, 5]);
    const versionsOf = (keys: readonly string[]): string[] => keys.map((key) => key.split("/")[1] ?? "").sort();

    expect(versionsOf(before)).toEqual(["v1", "v2", "v4"]);
    expect([failed.ok && failed.uploads, versionsOf(failed.ok ? failed.left : [])]).toEqual([2, ["v1", "v2", "v3"]]);
    expect([first, rest]).toMatchObject([
      { ok: true, uploads: 2, left: [], next: { uploads: true } },
      { ok: true, uploads: 1, left: [] },
    ]);
    expect([versionsOf(await world.keys()), await uploads(), await getSite(world.install, ADMIN, site)]).toMatchObject([["v4"], 0, { site: { live_version: 4 } }]);
  });

  // Drift: a job the host dropped leaves its copy pending with nobody told; swept in silence, the person who pressed Duplicate would never learn that no site was made.
  // Each case has a database of its own: a note of the same kind and hour as another adds no row, so one case would hide a second one's note.
  test.each([
    ["two copies whose job never finished them are noted as copy_failed, in one row", ["copy", "copy"], [["copy_failed", 1]]],
    ["a copy somebody cancelled is noted as nothing", ["cancelled"], []],
    ["a publish nobody finished is noted as nothing", ["publish"], []],
  ] as const)("%s, and each goes with its files once 25 hours have passed and not before", async (_case, left, problems) => {
    const world = await makeWorld();
    const source = await sized(world, "report", 120);
    const kept = (await world.keys()).length;
    const begin = async (): Promise<string> => {
      const begun = await duplicateSite(world.install, OWNER, { site: source }, 1, SILENT_JOBS);
      if (!begun.ok || begun.site !== null) throw new Error("the fixture copy was not left unfinished");

      return begun.copy.upload;
    };
    const leave = { copy: begin, cancelled: async () => cancelCopy(world.install, OWNER, await begin(), SILENT_JOBS), publish: async () => staged(world, { name: "draft" }) };
    for (const what of left) await leave[what]();

    const noted = async (): Promise<unknown[]> => (await world.install.database.listProblems(dayOf(NOW))).map(({ kind, count, day }) => [kind, count, day]);

    world.clock.now = NOW + 25 * HOUR;
    const early = [await sweepExpired(world.install, ADMIN, { limit: 10, from: { uploads: true } }), await noted()];
    world.clock.now = NOW + 25 * HOUR + 1;
    const swept = await sweepExpired(world.install, ADMIN, { limit: 10, from: { uploads: true } });

    expect(early).toMatchObject([{ ok: true, uploads: 0 }, []]);
    // The source's own finished upload goes with the ones left.
    expect([swept, await noted(), (await world.keys()).length - kept]).toMatchObject([{ ok: true, uploads: left.length + 1, left: [] }, problems.map((problem) => [...problem, dayOf(NOW + 25 * HOUR + 1)]), 0]);
  });

  // Drift: a host's scheduled run keeps one call to its database for this note in a step. A note for each copy asks again whenever the clock passes an hour between two, and the run would pass what one invocation may ask.
  test("a step that passes an hour of the clock between two unfinished copies asks the database for one note", async () => {
    const world = await makeWorld();
    const source = await sized(world, "report", 120);
    for (let copy = 0; copy < 2; copy += 1) await duplicateSite(world.install, OWNER, { site: source, name: `copy-${copy}` }, 1, SILENT_JOBS);

    world.clock.now = NOW + 25 * HOUR + 1;
    const abandon = world.install.database.abandonUpload.bind(world.install.database);
    spyOn(world.install.database, "abandonUpload").mockImplementation((id) => {
      world.clock.now += HOUR;

      return abandon(id);
    });
    const notes = spyOn(world.install.database, "noteProblem");
    const swept = await sweepExpired(world.install, ADMIN, { limit: 10, from: { uploads: true } });

    expect([swept.ok && swept.uploads, notes.mock.calls.length]).toEqual([3, 1]);
  });

  // Drift: the sweep deletes sites for good; it must run for an admin alone and never on a limit that is no count.
  test.each([
    ["a publisher", OWNER, { limit: 10 }, { ok: false, code: "not_allowed" }],
    ["a limit of none", ADMIN, { limit: 0 }, { ok: false, code: "bad_argument", about: "limit" }],
    ["a limit over a page", ADMIN, { limit: 101 }, { ok: false, code: "bad_argument", about: "limit" }],
    ["a place that is none", ADMIN, { limit: 10, from: { trash: "yes" } }, { ok: false, code: "bad_argument", about: "from" }],
  ] as const)("a sweep for %s is refused and changes nothing", async (_why, actor, step, refusal) => {
    const world = await makeWorld();
    await made(world, OWNER, "expiring", { expires: "1d" });
    world.clock.now = NOW + 2 * DAY;

    expect(await sweepExpired(world.install, actor, step as never)).toEqual(refusal as never);
    expect(await world.audit()).toEqual(["create"]);
  });
});
