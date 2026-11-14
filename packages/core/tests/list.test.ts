import { describe, expect, test } from "bun:test";

import { deleteSite } from "../src/actions/delete";
import { listSites } from "../src/actions/list";
import { ADMIN, made, makeWorld, NOW, OWNER, STRANGER, type World } from "./actions-fixture";

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
