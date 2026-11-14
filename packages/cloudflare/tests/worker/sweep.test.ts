// The scheduled run, driven as Cloudflare's cron trigger drives it. Nothing else ever moves an expired site to the trash or empties the trash.

import { reset } from "cloudflare:test";
import { publishSite } from "@poplin/core/src/actions/publish";
import { ROUTES } from "@poplin/core/src/api/routes";
import { parseUserCode } from "@poplin/core/src/auth/computer-logins";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN, api, ask, BINDINGS, countedBindings, done, installOf, instance, OWNER, page, publish, sweep, tokenOf, type World, wait, world } from "./support/install";

/** The most database and bucket calls one scheduled invocation may make, the start of its instance included: the entry's own stated budget, under Cloudflare's 1,000 on the Free plan. */
const INVOCATION_CALLS = 300;

/** A quarter of an hour: one run begins with the sites, the next with the trash, the third with the uploads, the fourth with the leftovers. */
const TURN_MS = 15 * 60 * 1000;

/** The place of the trash among the parts of the walk. */
const TRASH_TURN = 1;

/** The files one removal takes from a folder whose list pages hold one object each. */
const WHOLE_REMOVAL = 15;

/** What a step over five sat-out sites costs when each takes a whole removal: the settings, the listing, and per site a read, a change, 30 bucket calls, and the leftover forgotten. */
const MOST_STEP_CALLS = 167;

/** The one file of a site made only to be swept. */
const HTML = new TextEncoder().encode("<p>short-lived</p>");

let w: World;

/** Move the clock to the next quarter hour whose run begins with the part at this place of the walk: 0 for the sites. */
function toTheTurnOf(part: number): void {
  const turn = Math.ceil(w.clock.now / TURN_MS);

  w.clock.now = (turn + ((4 + part - (turn % 4)) % 4)) * TURN_MS;
}

/** The bucket with every list page cut to one object, so one removal, which walks 15 pages, takes 15 files. */
function shortPages(bucket: R2Bucket): R2Bucket {
  return new Proxy(bucket, {
    get(inner, name) {
      if (name !== "list") return Reflect.get(inner, name, inner);

      return (options: R2ListOptions): Promise<R2Objects> => inner.list({ ...options, limit: 1 });
    },
  });
}

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
    const begun = await done<{ upload: { id: string } }>(await api(worker, token, "POST", ROUTES.beginPublish.path(), { name: "unfinished", files: manifest }));
    await done(await api(worker, token, "PUT", ROUTES.uploadFile.path({ upload: begun.upload.id, path: "index.html" }), HTML));
    const stored = await keysUnder("");

    wait(w, 2);
    toTheTurnOf(0);
    await sweep(worker, w);
    const afterExpiry = await states();

    wait(w, 8 * 24);
    toTheTurnOf(0);
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

  // Drift: a login nobody allowed or collected leaves the table by the sweep alone; a run that never reached the end of the walk would keep every one for good.
  test("a login that ran out is removed by the run that ends the walk, and one still waiting stays", async () => {
    const worker = instance(w);
    await ask(worker, `${ADMIN}/api/whoami`);
    const begin = async (): Promise<string> => (await done<{ code: string }>(await api(worker, null, "POST", ROUTES.beginLogin.path(), { scope: "publisher", computer: "laptop" }))).code;
    const { database } = await installOf(w);
    const stored = async (shown: string): Promise<boolean> => {
      const code = parseUserCode(shown);

      return code !== undefined && (await database.findComputerLogin(code)) !== undefined;
    };
    const old = await begin();

    wait(w, 1);
    toTheTurnOf(0);
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
    const worker = instance(w);
    const runs: number[] = [];

    for (let run = 0; run < 4; run += 1) {
      wait(w, 0.25);
      tally.calls = 0;
      await sweep(worker, w, countedBindings(tally));
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
    toTheTurnOf(TRASH_TURN);
    const counted = countedBindings(tally);
    await sweep(instance(w), w, { ...counted, SITES: shortPages(counted.SITES) });

    expect([await states(), (await keysUnder("")).length]).toEqual([{ live: 0, trash: 0 }, 0]);
    expect(tally.calls).toBeGreaterThanOrEqual(MOST_STEP_CALLS);
    expect(tally.calls).toBeLessThanOrEqual(INVOCATION_CALLS);
  });

  // Drift: a run that walked until the walk ended would pass Cloudflare's per-invocation limit on a large install and be cut off mid-change; one that forgot its place would look at the same sites every time.
  test("an invocation that starts its instance stops inside its call budget on an install too large for one run, and the next run of the instance goes on where it stopped", async () => {
    const tally = { calls: 0 };
    const worker = instance(w);
    await ask(instance(w), `${ADMIN}/api/whoami`);
    const install = await installOf(w);
    const file = { path: "index.html", size: HTML.byteLength, contentType: "text/html", open: () => new Blob([HTML]).stream() };

    // The listing is newest first: the three expired sites come last, behind more lasting sites than one run looks at.
    for (const [count, name, expires] of [[3, "brief", "1h"], [110, "lasting", "never"]] as const) {
      for (let made = 0; made < count; made += 1) {
        const site = await publishSite(install, { scope: "admin", holder: OWNER }, { name: `${name}-${made}`, expires, files: [file] });
        if (!site.ok) throw new Error(`the test's site was refused: ${site.code}`);
      }

      wait(w, 2);
    }

    toTheTurnOf(0);
    await sweep(worker, w, countedBindings(tally));
    const first = { calls: tally.calls, trash: (await states()).trash };

    wait(w, 0.25);
    tally.calls = 0;
    await sweep(worker, w);

    expect(first.calls).toBeGreaterThan(INVOCATION_CALLS / 3);
    expect(first.calls).toBeLessThanOrEqual(INVOCATION_CALLS);
    expect(tally.calls).toBeLessThanOrEqual(INVOCATION_CALLS);
    expect([first.trash, (await states()).trash]).toEqual([0, 3]);
  });
});
