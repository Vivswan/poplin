import { describe, expect, spyOn, test } from "bun:test";

import { deleteSite } from "../src/actions/delete";
import { listSites } from "../src/actions/list";
import { restoreSite } from "../src/actions/restore";
import { updateSite } from "../src/actions/set";
import { getSite } from "../src/actions/show";
import { sweepExpired } from "../src/actions/sweep";
import { ADMIN, DAY, made, makeWorld, NOW, OWNER, type World } from "./actions-fixture";

/** Run a whole walk, step after step, and answer what each step did. */
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

describe("sweepExpired", () => {
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
      ],
      [
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
  test("a step looks at no more than `limit` sites, and following `next` reaches every site and all of the trash", async () => {
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
      [0, 0, []],
      [0, 1, []],
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
    const list = world.install.database.listSites.bind(world.install.database);
    spyOn(world.install.database, "listSites").mockImplementation(async (query) => {
      const page = await list(query);
      if (query.trash) await restoreSite(world.install, OWNER, restored);
      if (!query.trash) await updateSite(world.install, OWNER, { site: renewed, expires: "never" });

      return page;
    });

    expect(await walk(world, 10)).toEqual([
      [0, 0, []],
      [0, 0, []],
    ]);
    expect([await getSite(world.install, OWNER, renewed), await getSite(world.install, OWNER, restored)]).toMatchObject([
      { site: { state: "live", expires: "never" } },
      { site: { state: "live" } },
    ]);
    expect((await world.keys()).length).toBe(4);
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
