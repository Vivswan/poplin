// The scheduled run, driven as Cloudflare's cron trigger drives it. Nothing else ever moves an expired site to the trash or empties the trash.

import { reset } from "cloudflare:test";
import { publishSite } from "@poplin/core/src/actions/publish";
import { SWEEP_SPARE_WRITES } from "@poplin/core/src/actions/sweep";
import { parseUserCode } from "@poplin/core/src/auth/computer-logins";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { dayOf } from "@poplin/core/src/records/views";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ADMIN, api, ask, BINDINGS, countedBindings, done, freePlanBindings, installOf, instance, OWNER, page, problemsOf, publish, refusingDatabase, sendFile, shortPages, sweep, tokenOf, type World, wait, world } from "./support/install";

/** The most database and bucket calls one scheduled invocation may make, the start of its instance included: 50 to the database, which is all D1 answers on the Free plan, and 250 to the bucket. */
const INVOCATION_CALLS = 300;

/** The milliseconds of one UTC day. */
const DAY_MS = 86_400_000;

/** The files one removal takes from a folder whose list pages hold one object each. */
const WHOLE_REMOVAL = 15;

/** What a step over five sat-out sites costs when each takes a whole removal: the listing of the due ones, the day's count of writes to the bucket, and per site a change, 30 bucket calls, and the leftover forgotten. */
const MOST_STEP_CALLS = 162;

/** The one file of a site made only to be swept. */
const HTML = new TextEncoder().encode("<p>short-lived</p>");

let w: World;

async function keysUnder(prefix: string): Promise<string[]> {
  return (await BINDINGS.SITES.list({ prefix })).objects.map((object) => object.key);
}

async function states(): Promise<Record<string, number>> {
  const { database } = await installOf(w);
  const [live, trash] = await Promise.all([database.listSites({ trash: false, limit: 100 }), database.listSites({ trash: true, limit: 100 })]);

  return { live: live.sites.length, trash: trash.sites.length };
}

beforeEach(async () => {
  await reset();
  w = await world();
});

describe("the scheduled run", () => {
  // Drift: without the handler, or with one that never reaches the later parts of the walk, expired sites stay live in the listing and the bucket fills with files nothing serves.
  test("an expired site reaches the trash, then leaves it with its files after trash_days, and an upload nobody finished is removed with its files", async () => {
    const worker = instance(w);
    const token = await tokenOf(w, "publisher");
    const kept = await publish(worker, token, { name: "kept" }, [page("<p>kept</p>")]);
    const brief = await publish(worker, token, { name: "brief", expires: "1h" }, [page("<p>brief</p>")]);
    const manifest = [{ path: "index.html", size: HTML.byteLength, content_type: "text/html" }];
    const begun = await done<{ upload: { id: string } }>(await api(worker, token).uploads.$post({ query: {}, json: { name: "unfinished", files: manifest } }));
    await done(await sendFile(api(worker, token), begun.upload.id, { path: "index.html", body: HTML }));
    const stored = await keysUnder("");

    wait(w, 2);
    await sweep(worker, w);
    const afterExpiry = await states();

    wait(w, 8 * 24);
    await sweep(worker, w);
    const { database } = await installOf(w);
    const left = await keysUnder("");
    const activity = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "trash" || entry.action === "delete");

    expect(stored).toHaveLength(3);
    expect(afterExpiry).toEqual({ live: 1, trash: 1 });
    expect(await states()).toEqual({ live: 1, trash: 0 });
    expect(left).toHaveLength(1);
    expect((await ask(worker, `${ADMIN}/api/sites/${kept.label}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect(activity.map((entry) => `${entry.action} ${entry.site?.id === brief.id} by ${entry.by}`)).toEqual(["delete true by sweep@poplin.invalid", "trash true by sweep@poplin.invalid"]);
    expect(await database.listUploads({ before: w.clock.now, limit: 100 })).toEqual({ uploads: [] });
  });

  // Drift: the run comes 96 times a day whether anything is due or not. One that walked every site to find the due ones, and read the settings at each step, asked more of the database the more sites an install held, for nothing.
  test("a run with nothing due asks the database six questions on an instance that runs, and one more on a day's first run to keep what the website said, however many sites the install holds", async () => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`, {}, countedBindings(tally));
    const install = await installOf(w);
    const file = { path: "index.html", size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() };
    for (let made = 0; made < 12; made += 1) await publishSite(install, { scope: "admin", holder: OWNER }, { name: `lasting-${made}`, files: [file] });
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    const run = async (): Promise<number> => {
      tally.calls = 0;
      await sweep(worker, w);

      return tally.calls;
    };

    const first = await run();
    wait(w, 0.25);
    const later = [await run()];
    wait(w, 0.25);
    later.push(await run());

    expect([first, later, await states()]).toEqual([7, [6, 6], { live: 12, trash: 0 }]);
  });

  // Drift: R2 bills every listing past a month's free million writes, and the sweep lists a folder to empty it. A run that listed uncounted would have no bound; one that shared the day's bound with every publish could be kept from removing files for good.
  test("a run's listings are counted against the day; a day used up to the sweep's own share keeps the files of a removed site, and a day used up by everything else still lets the sweep remove them", async () => {
    const worker = instance(w);
    const { database } = await installOf(w);
    await publish(worker, await tokenOf(w, "publisher"), { name: "brief", expires: "1h" }, [page("<p>brief</p>")]);
    const most = (await database.readSettings())?.max_storage_writes_per_day ?? 0;
    const seen = async (): Promise<unknown> => [await states(), (await keysUnder("")).length, (await database.listLeftovers({ limit: 10 })).folders.length, (await database.readStorageWrites(dayOf(w.clock.now)))?.writes];

    wait(w, 2);
    await sweep(worker, w);
    wait(w, 8 * 24);
    await database.addStorageWrites(dayOf(w.clock.now), most + SWEEP_SPARE_WRITES);
    await sweep(worker, w);
    const usedUp = await seen();

    wait(w, 24);
    await database.addStorageWrites(dayOf(w.clock.now), most);
    await sweep(worker, w);

    expect([usedUp, await seen()]).toEqual([
      [{ live: 0, trash: 0 }, 1, 1, most + SWEEP_SPARE_WRITES],
      [{ live: 0, trash: 0 }, 0, 0, most + 1],
    ]);
  });

  // Drift: a run that failed was thrown into the provider's log of the schedule, which nobody opens, so sites stayed past their expiry with no word to the owner.
  test("a run the database fails is thrown on in fixed words, and noted as a clean-up that did not finish", async () => {
    const locked = { ...BINDINGS, DB: refusingDatabase(/sweep_place/i) };
    await ask(instance(w), `${ADMIN}/api/whoami`);

    const run = await sweep(instance(w), w, locked).then(() => "ran", String);

    expect(run).toBe("Error: poplin: the sweep failed (Error)");
    expect(await problemsOf(w)).toEqual([["sweep_failed", 1, "the table is locked"]]);
  });

  // Drift: nothing but the scheduled run ever asks which version is the newest. An entry that did not hand it the fetch, or a run that asked every time, would leave the install silent or have it ask the website 96 times a day.
  test("the runs of one day ask the website once, the API then names the newer version to a token, and the next day's first run asks again", async () => {
    const asked: string[] = [];
    const release = { version: "999.0.0", released: "2026-12-01", notes: "https://example.com/changelog/#v999-0-0", schema: OWN_SCHEMA + 1 };
    const latest = {
      fetch: async (address: string): Promise<Response> => {
        asked.push(new URL(address).pathname.split("/").at(-1) ?? "");

        return Response.json(release);
      },
    };
    const token = await tokenOf(w, "publisher");
    const whoami = async (): Promise<unknown> => (await done<{ update?: unknown }>(await api(instance(w, undefined, latest), token).whoami.$get({ query: {} }))).update;
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;
    const before = await whoami();

    for (let run = 0; run < 3; run += 1) {
      await sweep(instance(w, undefined, latest), w);
      wait(w, 0.25);
    }

    const sameDay = asked.length;
    const after = await whoami();
    wait(w, 24);
    await sweep(instance(w, undefined, latest), w);

    expect([before, sameDay, asked]).toEqual([undefined, 1, ["latest.json", "latest.json"]]);
    expect(after).toMatchObject({ newest: "999.0.0", released: "2026-12-01", notes: release.notes, database: true });
  });

  // Drift: nothing but the scheduled run starts an update with nobody asking. A handler that did not hand it the version or the build's fetch would leave the switch dead.
  // A start that cost more queries than counted here could pass what D1 answers one invocation.
  test("with auto_update on, the run three days after a release was first seen starts one build inside a Free invocation, five database calls above a day's first run, and no later run starts another", async () => {
    const built: string[] = [];
    const tally = { calls: 0 };
    const hook = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const latest = { fetch: async (): Promise<Response> => Response.json({ version: "999.0.0", released: "2026-12-01", notes: "https://example.com/changelog/#v999-0-0", schema: OWN_SCHEMA }) };
    const rebuild = async (address: string): Promise<Response> => {
      built.push(address);

      return new Response(null, { status: 204 });
    };
    const run = async (): Promise<number> => {
      tally.calls = 0;
      await sweep(instance(w, undefined, latest, rebuild), w, freePlanBindings(tally));

      return tally.calls;
    };
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const { database } = await installOf(w);
    await database.changeSettings({ auto_update: true }, { by: OWNER, at: w.clock.now });
    await database.keepUpdateAddress(hook, { by: OWNER, at: w.clock.now });
    w.clock.now = Math.ceil(w.clock.now / DAY_MS) * DAY_MS;

    await run();
    wait(w, 3 * 24 - 0.25);
    await run();
    const early = built.length;
    wait(w, 0.25);
    const starting = await run();
    wait(w, 0.25);
    await run();
    wait(w, 24);
    const dayAfter = await run();
    const started = (await database.listAudit({ limit: 100 })).filter((entry) => entry.action === "update_started").map(({ by, detail }) => ({ by, detail }));

    expect([early, built, starting - dayAfter]).toEqual([0, [hook], 5]);
    expect(started).toEqual([{ by: "sweep@poplin.invalid", detail: { from: "0.0.0", to: "999.0.0", automatic: true } }]);
  });

  // Drift: a login nobody allowed or collected leaves the table by the sweep alone; a run that never reached the end of the walk would keep every one for good.
  test("a login that ran out is removed by the run that ends the walk, and one still waiting stays", async () => {
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`);
    const begin = async (): Promise<string> => (await done<{ code: string }>(await api(worker, null).logins.$post({ query: {}, json: { scope: "publisher", computer: "laptop" } }))).code;
    const { database } = await installOf(w);
    const stored = async (shown: string): Promise<boolean> => {
      const code = parseUserCode(shown);

      return code !== undefined && (await database.findComputerLogin(code)) !== undefined;
    };
    const old = await begin();

    wait(w, 1);
    const waiting = await begin();
    await sweep(worker, w);

    expect([await stored(old), await stored(waiting)]).toEqual([false, true]);
  });

  // Drift: a site's row can go while its files stay, when the removal is cut off; nothing but the scheduled run ever comes back for them, and it must do so inside its budget.
  test("files a removed site left in the bucket are gone after the next scheduled runs, each inside its call budget, and the files of other sites stay", async () => {
    const tally = { calls: 0 };
    const token = await tokenOf(w, "publisher");
    await publish(instance(w), token, { name: "kept" }, [page("<p>kept</p>")]);
    const cut = await publish(instance(w), token, { name: "cut-off" }, [page("<p>cut off</p>")]);
    const { database } = await installOf(w);
    const row = (await database.listSites({ trash: false, limit: 10 })).sites.find((site) => site.id === cut.id);
    if (row === undefined) throw new Error("the test's site is not there");

    await database.deleteSite(row.id, { by: OWNER, at: w.clock.now });
    const before = [(await keysUnder("")).length, (await database.listLeftovers({ limit: 10 })).folders.length];
    const runs: number[] = [];

    for (let run = 0; run < 4; run += 1) {
      wait(w, 0.25);
      tally.calls = 0;
      await sweep(instance(w), w, freePlanBindings(tally));
      runs.push(tally.calls);
    }

    expect(before).toEqual([2, 1]);
    expect([(await keysUnder("")).length, await database.listLeftovers({ limit: 10 }), await states()]).toEqual([1, { folders: [] }, { live: 1, trash: 0 }]);
    expect([Math.min(...runs) > 0, Math.max(...runs) <= INVOCATION_CALLS]).toEqual([true, true]);
  });

  // Drift: a run starts a step only while the most a step can cost still fits; a step that cost more than the run allows for would pass the invocation's budget unseen.
  test("a run whose first step is as costly as a step gets, five sat-out sites that each take a whole removal, stays inside one invocation's calls", async () => {
    const tally = { calls: 0 };
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const install = await installOf(w);
    const files = Array.from({ length: WHOLE_REMOVAL }, (_, at) => ({ path: at === 0 ? "index.html" : `page-${at}.html`, size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() }));

    for (let made = 0; made < 5; made += 1) {
      const site = await publishSite(install, { scope: "admin", holder: OWNER }, { name: `large-${made}`, files });
      if (!site.ok) throw new Error(`the test's site was refused: ${site.code}`);

      await install.database.trashSite(site.site.id, { by: OWNER, at: w.clock.now });
    }

    wait(w, 8 * 24);
    const counted = freePlanBindings(tally);
    await sweep(instance(w), w, { ...counted, SITES: shortPages(counted.SITES) });

    expect([await states(), (await keysUnder("")).length]).toEqual([{ live: 0, trash: 0 }, 0]);
    expect(tally.calls).toBeGreaterThanOrEqual(MOST_STEP_CALLS);
    expect(tally.calls).toBeLessThanOrEqual(INVOCATION_CALLS);
  });

  // Drift: Cloudflare may start a new instance for every cron run, and D1 answers a Free invocation 50 queries. A run that walked the sites to find the due ones spent them on the rest, and an expired site waited a run for every fifty live ones before it.
  // A run takes as many due sites as its calls allow, and the next one, whatever instance makes it, finds the rest as the first ones still due.
  test("thirty expired sites behind sixty newer live ones reach the trash in two runs, twenty-five in the first, each run a new instance that D1 refuses a fifty-first query", async () => {
    const tally = { calls: 0 };
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const install = await installOf(w);
    const file = { path: "index.html", size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() };

    for (const [count, name, expires] of [[30, "brief", "1h"], [60, "lasting", "never"]] as const) {
      for (let made = 0; made < count; made += 1) {
        const site = await publishSite(install, { scope: "admin", holder: OWNER }, { name: `${name}-${made}`, expires, files: [file] });
        if (!site.ok) throw new Error(`the test's site was refused: ${site.code}`);
      }

      wait(w, 2);
    }

    const runs = [];
    for (let run = 0; run < 3; run += 1) {
      wait(w, 0.25);
      tally.calls = 0;
      await sweep(instance(w), w, freePlanBindings(tally));
      runs.push({ calls: tally.calls, trash: (await states()).trash });
    }

    expect(runs.map((run) => run.trash)).toEqual([25, 30, 30]);
    expect(Math.max(...runs.map((run) => run.calls))).toBeLessThanOrEqual(INVOCATION_CALLS);
  });

  // Drift: Cloudflare writes what a run throws into its log, message and all, and an error's message may repeat a stored value. A run that threw its own error would put that value in the log; one that swallowed it would look like a run that worked.
  test("a run on a Worker with a wrong variable fails in fixed words, and the log names the variable, never its value, and where the run stopped", async () => {
    using failed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...BINDINGS, ZONE: { public_word: "wiki" } } as unknown as typeof BINDINGS;

    const thrown = await sweep(instance(w), w, broken).catch((error: unknown) => error);
    const lines = failed.mock.calls.map(([line]) => String(line));

    expect(String(thrown)).toBe("Error: poplin: the sweep failed (Error)");
    expect(lines.map((line) => line.split("\n")[0])).toEqual(["poplin: the sweep did not run. This poplin install cannot start. These variables of its Worker are missing or wrong:"]);
    expect([lines[0]?.includes("  ZONE: bad-shape"), `${lines.join("\n")}${(thrown as Error).stack}`.includes("wiki")]).toEqual([true, false]);
  });
});
