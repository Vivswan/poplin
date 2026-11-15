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

/** Every page of a listing, two sites a page, each asked with the `next` of the one before. */
async function pagesOf(world: World, actor: typeof ADMIN, query: Parameters<typeof listSites>[2]): Promise<Extract<Awaited<ReturnType<typeof listSites>>, { ok: true }>["sites"][]> {
  const pages = [];
  let after: Parameters<typeof listSites>[2] = {};
  do {
    const page = await listSites(world.install, actor, { ...query, limit: 2, ...after });
    if (!page.ok) throw new Error(`the listing was refused: ${page.code}`);

    pages.push(page.sites);
    after = page.next === undefined ? {} : { after: page.next };
  } while (after.after !== undefined);

  return pages;
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

  // Drift: a table's header sorts and its filters narrow through these keys; a cursor that did not follow the order asked would skip or repeat sites from the second page on.
  test("`sort` and `dir` order every page of a listing, and `expires` narrows it", async () => {
    const world = await makeWorld();
    const drafts = [
      ["delta", OWNER, { expires: "1d" }],
      ["alpha", OWNER, { access: "public" }],
      ["charlie", OWNER, { access: "unlisted" }],
      ["bravo", OWNER, {}],
      ["echo", ADMIN, {}],
    ] as const;
    const ids: string[] = [];
    for (const [at, [name, actor, settings]] of drafts.entries()) {
      world.clock.now = NOW + at;
      ids.push(await made(world, actor, name, settings));
    }

    const walked = async (query: Parameters<typeof listSites>[2]): Promise<{ name: string; access: string }[]> => (await pagesOf(world, ADMIN, query)).flat();
    const named = async (query: Parameters<typeof listSites>[2]): Promise<string[]> => (await walked(query)).map((site) => site.name);
    const byAccess = await walked({ sort: "access" });

    expect(await named({ sort: "name" })).toEqual(["alpha", "bravo", "charlie", "delta", "echo"]);
    expect(await named({ sort: "name", dir: "desc" })).toEqual(["echo", "delta", "charlie", "bravo", "alpha"]);
    expect(await named({ sort: "updated", dir: "asc" })).toEqual(["delta", "alpha", "charlie", "bravo", "echo"]);
    expect([byAccess.map((site) => site.access), new Set(byAccess.map((site) => site.name)).size]).toEqual([["private", "private", "private", "unlisted", "public"], 5]);
    expect([await named({ expires: "set" }), await named({ expires: "never", sort: "name" })]).toEqual([["delta"], ["alpha", "bravo", "charlie", "echo"]]);
    expect(await names(world, OWNER, { sort: "name", dir: "desc" })).toEqual(["delta", "charlie", "bravo", "alpha"]);
    expect(await names(world, ADMIN, { sort: "name", after: { updated_at: NOW, id: ids[0] as never } })).toMatchObject({ ok: false, code: "bad_argument", about: "after" });
    expect(await names(world, ADMIN, { sort: "size" as "name" })).toMatchObject({ ok: false, code: "bad_argument", about: "sort" });
  });

  // Drift: a table's first heading sorts by the title each row shows; an order by the name alone would sort by a line nobody sees, and a `next` the action's own `after` refused would end the table at its first page.
  test("`sort: title` orders every page by what each site is listed with, and its cursor names the title it stopped at", async () => {
    const world = await makeWorld();
    const drafts = [
      ["zeta", { title: "apple" }],
      ["banana", {}],
      ["yak", { page_title: "Cherry" }],
      ["xray", { title: "Avocado" }],
      ["wolf", { title: "date", page_title: "Aardvark" }],
    ] as const;
    for (const [at, [name, settings]] of drafts.entries()) {
      world.clock.now = NOW + at;
      await made(world, OWNER, name, settings);
    }
    const shown = async (query: Parameters<typeof listSites>[2]): Promise<unknown> => (await pagesOf(world, OWNER, query)).map((page) => page.map((site) => site.title ?? site.name));
    const first = await listSites(world.install, OWNER, { sort: "title", limit: 2 });

    expect(await shown({ sort: "title" })).toEqual([["apple", "Avocado"], ["banana", "Cherry"], ["date"]]);
    expect(await shown({ sort: "title", dir: "desc" })).toEqual([["date", "Cherry"], ["banana", "Avocado"], ["apple"]]);
    expect(first.ok && first.next).toMatchObject({ title: "avocado" });
    expect(await names(world, OWNER, { sort: "title", after: { updated_at: NOW, id: "aaaaaaaaaaaa" as never, name: "zeta" } })).toMatchObject({ ok: false, code: "bad_argument", about: "after" });
  });

  // Drift: the dashboard's search box and its filter hand these two keys over; one read as a pattern, or dropped, would list sites nobody asked for.
  test("`named` keeps the sites whose name holds the text as typed, and `access` those of one access", async () => {
    const world = await makeWorld();
    for (const [at, name] of ["sales-report", "report-2026", "notes"].entries()) {
      world.clock.now = NOW + at;
      await made(world, OWNER, name);
    }

    expect(await names(world, OWNER, { named: "report" })).toEqual(["report-2026", "sales-report"]);
    expect(await names(world, OWNER, { named: "%" })).toEqual([]);
    expect(await names(world, OWNER, { named: "o_e" })).toEqual([]);
    expect(await names(world, OWNER, { access: "private" })).toEqual(["notes", "report-2026", "sales-report"]);
    expect(await names(world, OWNER, { access: "public" })).toEqual([]);
    expect(await names(world, OWNER, { named: "" })).toMatchObject({ ok: false, code: "bad_argument", about: "named" });
    expect(await names(world, OWNER, { access: "open" as "public" })).toMatchObject({ ok: false, code: "bad_argument", about: "access" });
  });

  // Drift: a listed site shows its title above its name; a search of the name alone would miss the site a person reads, and one of a title the listing hides would list a site with no hit to see.
  describe("`named` finds a site by its name or by the title it is listed with", () => {
    const PAGE_TITLE = "Report 50%_done's";
    const stocked = async (): Promise<World> => {
      const world = await makeWorld();
      const drafts = [
        ["report", {}],
        ["notes", { title: "Quarterly Report" }],
        ["draft", { page_title: PAGE_TITLE }],
        ["plans", { title: "Budget", page_title: "Report" }],
        ["misc", {}],
        ["old", { title: "Report archive" }],
      ] as const;
      for (const [at, [name, settings]] of drafts.entries()) {
        world.clock.now = NOW + at;
        const id = await made(world, OWNER, name, settings);
        if (name === "old") await deleteSite(world.install, OWNER, { site: id });
      }

      return world;
    };
    const walked = async (world: World, query: Parameters<typeof listSites>[2]): Promise<unknown[][]> =>
      (await pagesOf(world, OWNER, { sort: "name", ...query })).map((page) => page.map((site) => [site.name, site.title]));
    const REPORTS = [
      [
        ["draft", PAGE_TITLE],
        ["notes", "Quarterly Report"],
      ],
      [["report", null]],
    ];
    const OLDEST_FIRST = [
      [
        ["report", null],
        ["notes", "Quarterly Report"],
      ],
      [["draft", PAGE_TITLE]],
    ];

    test.each([
      ["a name, a typed title and a page's title, across two pages", { named: "report" }, REPORTS],
      ["capitals typed, paged from the oldest change", { named: "REPORT", sort: "updated", dir: "asc" }, OLDEST_FIRST],
      ["a typed title, which hides the page's own", { named: "budget" }, [[["plans", "Budget"]]]],
      ["signs of a pattern and a quote, as they stand", { named: "50%_done's" }, [[["draft", PAGE_TITLE]]]],
      ["signs that only a pattern would match", { named: "5_%" }, [[]]],
      ["a site with neither title", { named: "misc" }, [[["misc", null]]]],
      ["a text in no name and no title", { named: "ledger" }, [[]]],
      ["the trash", { named: "archive", trash: true }, [[["old", "Report archive"]]]],
      ["a title of the trash, looked for outside it", { named: "archive" }, [[]]],
    ] as const)("%s", async (_what, query, pages) => {
      expect<unknown>(await walked(await stocked(), query)).toEqual(pages);
    });
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
