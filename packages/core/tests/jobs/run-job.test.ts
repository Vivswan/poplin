import { describe, expect, spyOn, test } from "bun:test";

import { cancelCopy, duplicateSite } from "../../src/actions/duplicate";
import { listSites } from "../../src/actions/list";
import { publishSite } from "../../src/actions/publish";
import type { Job, Jobs } from "../../src/jobs/jobs";
import { failJob, runJob } from "../../src/jobs/run-job";
import { dayOf } from "../../src/records/views";
import type { ObjectKey } from "../../src/storage/storage";
import { BunSqliteDriver } from "../database/support/bun-sqlite-driver";
import { ADMIN, file, made, makeWorld, NOW, OWNER, STRANGER, type World } from "../actions/support/actions-fixture";

/** The calls a caller made before the action: one, as a caller that read a token did. */
const ASKING = 1;

/** The most calls to the database one round may make itself: the 44 a round is held to, less the 2 a host may make to start and the 2 that count the day's listings, which a host makes. */
const ROUND_DATABASE_CALLS = 40;

/** The most calls to the store one round may make. */
const STORE_CALLS = 250;

/** A site of three hundred files. The first call copies 112 of them, so two rounds are left. */
const MANY = [file("index.html", "<p>home</p>"), ...Array.from({ length: 299 }, (_page, at) => file(`pages/${at}.html`, `<p>${at}</p>`))];

/** A host that runs jobs by itself, as a test sees it: what was started and stopped, in order. */
function backgroundJobs(): { readonly jobs: Jobs; readonly started: Job[]; readonly stopped: Job[] } {
  const started: Job[] = [];
  const stopped: Job[] = [];

  return { jobs: { background: true, start: async (job) => void started.push(job), stop: async (job) => void stopped.push(job) }, started, stopped };
}

/** A site of `MANY`, and the copy of it one call began on a host that runs jobs by itself. */
async function begun(world: World, host: ReturnType<typeof backgroundJobs>): Promise<{ readonly source: string; readonly job: Job; readonly before: string[] }> {
  const source = await made(world, OWNER, "report");
  await publishSite(world.install, OWNER, { site: source, files: MANY });
  const before = await world.keys();
  const first = await duplicateSite(world.install, OWNER, { site: source, name: "report-draft" }, ASKING, host.jobs);
  const [job] = host.started;
  if (!first.ok || first.site !== null || job === undefined) throw new Error("the first call started no job");

  return { source, job, before };
}

async function problems(world: World): Promise<unknown[]> {
  return (await world.install.database.listProblems(dayOf(NOW))).map(({ kind, count, message }) => [kind, count, message]);
}

async function sites(world: World): Promise<number> {
  const listed = await listSites(world.install, ADMIN);

  return listed.ok ? listed.sites.length : -1;
}

describe("runJob", () => {
  // Drift: a copy the host runs has nobody asking; a job that named no upload, a round that waited for an ask, or an ask that copied beside the job would leave it half made or copy files twice.
  test("a copy too large for one call is started as one job, its rounds make the site with nobody asking, and an ask meanwhile copies nothing", async () => {
    const world = await makeWorld();
    const host = backgroundJobs();
    const { source, job } = await begun(world, host);
    using writes = spyOn(world.install.store, "write");
    using listings = spyOn(world.install.store, "list");
    const [written, listed] = [writes.mock.calls.length, listings.mock.calls.length];

    const asked = await duplicateSite(world.install, OWNER, { site: source, upload: job.upload }, ASKING, host.jobs);
    const untouched = [writes.mock.calls.length - written, listings.mock.calls.length - listed];
    const rounds = [await runJob(world.install, job), await sites(world), await runJob(world.install, job), await sites(world)];
    const after = await duplicateSite(world.install, OWNER, { site: source, upload: job.upload }, ASKING, host.jobs);

    expect([host.started, untouched, asked]).toEqual([[job], [0, 0], { ok: true, before: null, site: null, copy: { upload: job.upload, copied: null, files: 300 } }]);
    expect(rounds).toEqual(["more", 1, "done", 2]);
    expect(after).toMatchObject({ ok: true, site: { name: "report-draft", access: "private", files: 300, live_version: 1 }, copy: { copied: 300, files: 300 } });
    expect([await world.audit(), await problems(world)]).toEqual([["create", "publish", "create", "duplicate"], []]);
  });

  // Drift: a host runs a round again after a failure it saw, and may run one after the last; a round that copied a file twice or made a second site would spend the day's writes or the install's room.
  test("a round run after the copy is a site changes nothing, and a copy of one call's files starts no job", async () => {
    const world = await makeWorld();
    const host = backgroundJobs();
    const { job } = await begun(world, host);
    await runJob(world.install, job);
    await runJob(world.install, job);
    const keys = await world.keys();

    expect([await runJob(world.install, job), await world.keys(), await sites(world), await world.audit()]).toEqual(["done", keys, 2, ["create", "publish", "create", "duplicate"]]);

    const small = await duplicateSite(world.install, OWNER, { site: await made(world, OWNER, "notes") }, ASKING, host.jobs);

    expect([small.ok && small.site?.files, host.started.length]).toEqual([2, 1]);
  });

  // Drift: a host's limits are per round; a round that listed and copied more than a request does would be ended by the host with its files half written, again at every retry.
  test("each round of a copy of 2,001 files makes no more than 40 calls to the database and 250 to the store, and the copy is whole after 18", async () => {
    const world = await makeWorld();
    const host = backgroundJobs();
    const pages = Array.from({ length: 2_000 }, (_page, at) => file(`pages/${at}.html`, "x"));
    const source = await publishSite(world.install, OWNER, { name: "report", files: [file("index.html", "<p>home</p>"), ...pages] });
    if (!source.ok) throw new Error(`the source was refused: ${source.code}`);

    await duplicateSite(world.install, OWNER, { site: source.site.id }, ASKING, host.jobs);
    const [job] = host.started;
    if (job === undefined) throw new Error("no job was started");

    const left = { database: 0, store: 0 };
    const spend = (on: keyof typeof left): void => {
      left[on] -= 1;
      if (left[on] < 0) throw new Error(`the round made more calls to the ${on} than it may`);
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
    using _batches = spyOn(BunSqliteDriver.prototype, "batch").mockImplementation(function counted(this: BunSqliteDriver, statements) {
      spend("database");

      return batch.call(this, statements);
    });
    let rounds = 0;

    for (let went: "more" | "done" = "more"; went === "more"; rounds += 1) {
      Object.assign(left, { database: ROUND_DATABASE_CALLS, store: STORE_CALLS });
      went = await runJob({ ...world.install, store }, job);
    }

    expect([rounds, await sites(world)]).toEqual([18, 2]);
  }, 30_000);

  // Drift: Cancel is true by the record alone; a round that went on after it, or a stop sent for an upload nobody gave up, would make a site a person cancelled or end a stranger's copy.
  test("a cancelled copy is stopped once, its next round ends with no site, no file, and no problem, and a stranger's cancel stops nothing", async () => {
    const world = await makeWorld();
    const host = backgroundJobs();
    const { source, job, before } = await begun(world, host);

    const refused = await cancelCopy(world.install, STRANGER, job.upload, host.jobs);
    const stoppedByStranger = host.stopped.length;
    const cancelled = await cancelCopy(world.install, OWNER, job.upload, host.jobs);

    expect([refused, stoppedByStranger, cancelled, host.stopped]).toEqual([{ ok: false, code: "not_found", about: "upload" }, 0, { ok: true, left: [] }, [job]]);
    expect([await runJob(world.install, job), await world.keys(), await sites(world), await problems(world)]).toEqual(["done", before, 1, []]);
    expect(await duplicateSite(world.install, OWNER, { site: source, upload: job.upload }, ASKING, host.jobs)).toEqual({ ok: false, code: "not_found", about: "upload" });
  });

  // Drift: a job finishes a copy with nobody asking, so a Cancel can lose to it between its read and its write; told as done, the person would look for a copy that "was not made" in a list that shows it.
  test("a Cancel that loses to the job's last round is refused as finished, stops nothing, and the copy is a site", async () => {
    const world = await makeWorld();
    const host = backgroundJobs();
    const { job } = await begun(world, host);
    await runJob(world.install, job);
    const abandon = world.install.database.abandonUpload.bind(world.install.database);
    using _lost = spyOn(world.install.database, "abandonUpload").mockImplementation(async (id) => {
      await runJob(world.install, job);

      return abandon(id);
    });

    expect([await cancelCopy(world.install, OWNER, job.upload, host.jobs), host.stopped, await sites(world)]).toEqual([{ ok: false, code: "upload_finished", about: "upload" }, [], 2]);
  });

  // Drift: nobody waits on a copy the host runs; one that ended without a site and without a note would be a Duplicate that silently did nothing, with its files left to the sweep.
  test.each([
    ["a round that failed for good is given up", async (world: World, job: Job): Promise<unknown> => failJob(world.install, job, new Error("the store is down"))],
    [
      "a source that stopped keeping a file ends the round",
      async (world: World, job: Job): Promise<unknown> => {
        const [gone] = (await world.keys()).filter((key) => key.endsWith("/v2/pages/298.html"));
        await world.install.store.delete(gone as ObjectKey);

        return runJob(world.install, job);
      },
    ],
  ])("%s: the copy's files are removed, the problem `copy_failed` is noted, and an ask is answered that the copy is gone", async (_case, end) => {
    const world = await makeWorld();
    const host = backgroundJobs();
    const { source, job, before } = await begun(world, host);

    await end(world, job);
    const left = (await world.keys()).filter((key) => !before.includes(key));

    expect([left, (await problems(world)).map((problem) => (problem as unknown[])[0]), await sites(world)]).toEqual([[], ["copy_failed"], 1]);
    expect(await duplicateSite(world.install, OWNER, { site: source, upload: job.upload }, ASKING, host.jobs)).toEqual({ ok: false, code: "not_found", about: "upload" });
    expect(await runJob(world.install, job)).toBe("done");
  });

  // Drift: a host that refuses a job would leave an upload nobody runs and nobody can ask to run: a copy that stays "copying" until it runs out a day later.
  test("a copy whose job the host did not take is given up with its files, and the failure is the caller's", async () => {
    const world = await makeWorld();
    const source = await made(world, OWNER, "report");
    await publishSite(world.install, OWNER, { site: source, files: MANY });
    const before = await world.keys();
    const refusing: Jobs = { background: true, start: async () => Promise.reject(new Error("the host took no job")), stop: async () => {} };

    await expect(duplicateSite(world.install, OWNER, { site: source }, ASKING, refusing)).rejects.toThrow("the host took no job");
    expect([await world.keys(), await sites(world)]).toEqual([before, 1]);
  });
});
