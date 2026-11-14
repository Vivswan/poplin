import { describe, expect, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { listSites } from "../../src/actions/list";
import { updateSite } from "../../src/actions/set";
import { getSite } from "../../src/actions/show";
import { ADMIN, DAY, made, makeWorld, NOW, OWNER, STRANGER, type World } from "./support/actions-fixture";

async function names(world: World, actor: typeof ADMIN, query: Parameters<typeof listSites>[2] = {}): Promise<unknown> {
  const listed = await listSites(world.install, actor, query);

  return listed.ok ? listed.sites.map((site) => site.name) : listed;
}

describe("listSites", () => {
  // Drift: the listing is where a publisher would first see another's site; the owner filter is the only thing between them.
  test("an admin lists every site and a publisher only its own, the trash apart, the site changed last first", async () => {
    const world = await makeWorld();
    for (const [at, actor, name] of [
      [1, OWNER, "first"],
      [2, STRANGER, "second"],
      [3, OWNER, "third"],
      [4, ADMIN, "fourth"],
    ] as const) {
      world.clock.now = NOW + at;
      await made(world, actor, name);
    }
    const newest = await listSites(world.install, OWNER, { limit: 1 });
    if (!newest.ok) throw new Error("the listing was refused");

    await deleteSite(world.install, ADMIN, { site: newest.sites[0]?.id ?? "" });

    expect([
      await names(world, ADMIN),
      await names(world, OWNER),
      await names(world, STRANGER),
      await names(world, ADMIN, { trash: true }),
      await names(world, OWNER, { trash: true }),
      await names(world, STRANGER, { trash: true }),
    ]).toEqual([["fourth", "second", "first"], ["first"], ["second"], ["third"], ["third"], []]);
  });

  // Drift: views are read from the day's counts when a site is shown or listed; a count of another site, of a day outside the seven, or an exact-looking number on a change's answer would mislead its owner.
  test("showing and listing a site answer its views of today and of seven days from the counts, each site its own, and a change answers none", async () => {
    const world = await makeWorld();
    const report = await made(world, OWNER, "report");
    const notes = await made(world, OWNER, "notes");
    world.clock.now = NOW + 8 * DAY;
    const today = new Date(world.clock.now).toISOString().slice(0, 10);
    const earlier = new Date(world.clock.now - 6 * DAY).toISOString().slice(0, 10);
    await world.install.database.addRequests({ day: earlier, site: report as never, requests: 300, views: 100 });
    await world.install.database.addRequests({ day: today, site: report as never, requests: 50, views: 20 });
    await world.install.database.addRequests({ day: today, site: notes as never, requests: 4, views: 0 });

    const shown = await getSite(world.install, OWNER, report);
    const listed = await listSites(world.install, OWNER);
    const changed = await updateSite(world.install, OWNER, { site: report, title: "Q3" });

    expect<unknown>([shown.ok && shown.site.views, listed.ok && Object.fromEntries(listed.sites.map((site) => [site.name, site.views])), changed.ok && changed.site.views]).toEqual([
      { today: 20, week: 120 },
      { notes: { today: 0, week: 0 }, report: { today: 20, week: 120 } },
      null,
    ]);
  });

  // Drift: a page's `next` is what the following call sends back; a cursor that skipped or repeated a site would hide one from the dashboard.
  test("a listing is paged by `limit`, and `next` given as `after` continues it to the end", async () => {
    const world = await makeWorld();
    for (const [at, name] of ["one", "two", "three"].entries()) {
      world.clock.now = NOW + at;
      await made(world, OWNER, name);
    }

    const first = await listSites(world.install, OWNER, { limit: 2 });
    if (!first.ok) throw new Error("the listing was refused");

    const second = await listSites(world.install, OWNER, { limit: 2, after: first.next });

    expect<unknown>(first.sites.map((site) => site.name)).toEqual(["three", "two"]);
    expect(second).toMatchObject({ ok: true, sites: [{ name: "one" }] });
    expect("next" in second).toBe(false);
  });

  // Drift: the query comes from a request as sent; one passed on unchecked would reach the database as a thrown error instead of an answer.
  test.each([
    [{ limit: 0 }, "limit"],
    [{ limit: 101 }, "limit"],
    [{ trash: "yes" }, "trash"],
    [{ after: { updated_at: 1, id: "short" } }, "after"],
    [{ owner: STRANGER.holder }, "owner"],
  ] as const)("a listing asked with %j is refused", async (query, about) => {
    const world = await makeWorld();

    expect(await listSites(world.install, OWNER, query as never)).toEqual({ ok: false, code: "bad_argument", about });
  });
});
