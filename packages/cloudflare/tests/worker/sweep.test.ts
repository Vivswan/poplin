// The scheduled run, driven as Cloudflare's cron trigger drives it. Nothing else ever moves an expired site to the trash or empties the trash.

import { reset } from "cloudflare:test";
import { publishSite } from "@poplin/core/src/actions/publish";
import { ROUTES } from "@poplin/core/src/api/routes";
import { beforeEach, describe, expect, test } from "vitest";
import { ADMIN, api, ask, BINDINGS, countedBindings, done, installOf, instance, OWNER, page, publish, sweep, tokenOf, type World, wait, world } from "./support/install";

/** The most database and bucket calls one scheduled invocation may make, the start of its instance included: the entry's own stated budget, under Cloudflare's 1,000 on the Free plan. */
const INVOCATION_CALLS = 300;

/** A quarter of an hour: one run begins with the sites, the next with the trash, the third with the uploads. */
const TURN_MS = 15 * 60 * 1000;

/** The one file of a site made only to be swept. */
const HTML = new TextEncoder().encode("<p>short-lived</p>");

let w: World;

/** Move the clock to the next quarter hour whose run begins with the sites. */
function toTheSitesTurn(): void {
  const turn = Math.ceil(w.clock.now / TURN_MS);

  w.clock.now = (turn + ((3 - (turn % 3)) % 3)) * TURN_MS;
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
    toTheSitesTurn();
    await sweep(worker, w);
    const afterExpiry = await states();

    wait(w, 8 * 24);
    toTheSitesTurn();
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

    toTheSitesTurn();
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
