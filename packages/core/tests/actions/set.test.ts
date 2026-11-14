import { describe, expect, spyOn, test } from "bun:test";

import { deleteSite } from "../../src/actions/delete";
import { newLink } from "../../src/actions/new-link";
import { restoreSite } from "../../src/actions/restore";
import { updateSite } from "../../src/actions/set";
import { getSite } from "../../src/actions/show";
import { ADMIN, DAY, made, makeWorld, NOW, OWNER } from "./support/actions-fixture";

type Changes = Omit<Parameters<typeof updateSite>[2], "site">;

describe("updateSite", () => {
  // Drift: a public name is one site's address at a time; a claim that slipped past a holder would point a public address at another site.
  test("going public claims the public name, a held name is refused, the trash keeps the name, and leaving public frees it", async () => {
    const world = await makeWorld();
    const first = await made(world, OWNER, "report");
    const second = await made(world, OWNER, "report");
    const steps = [
      await updateSite(world.install, OWNER, { site: first, access: "public" }),
      await updateSite(world.install, OWNER, { site: second, access: "public" }),
      await updateSite(world.install, OWNER, { site: second, access: "public", public_name: "docs" }),
      await deleteSite(world.install, OWNER, { site: first }),
      await updateSite(world.install, OWNER, { site: second, access: "public", public_name: "report" }),
      await restoreSite(world.install, OWNER, "report"),
      await updateSite(world.install, OWNER, { site: "report", access: "unlisted" }),
      await updateSite(world.install, OWNER, { site: "docs", access: "public" }),
      await getSite(world.install, OWNER, "docs"),
    ];

    expect(steps).toMatchObject([
      { ok: true, before: { access: "private", public_name: null }, site: { id: first, access: "public", public_name: "report", url: "https://report-page.example.com" } },
      { ok: false, code: "name_taken" },
      { ok: true, site: { id: second, public_name: "docs", addresses: { site: `https://report--${second}-page.example.com`, public: "https://docs-page.example.com" } } },
      { ok: true, site: { id: first, state: "trash", public_name: "report" } },
      { ok: false, code: "name_taken" },
      { ok: true, site: { id: first, state: "live" } },
      { ok: true, site: { id: first, access: "unlisted", public_name: null, url: `https://report--${first}-page.example.com` } },
      { ok: true, site: { id: second, public_name: "report" } },
      { ok: false, code: "not_found" },
    ]);
    expect(await world.audit()).toEqual(["create", "create", "access", "access", "trash", "restore", "access", "access"]);
  });

  // Drift: `--expires 7d` counts from the moment it is set; a span counted from the site's creation would trash an old site at once.
  test("each detail is set as asked, an expiry counts from now, and a detail left out stays", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report", { title: "First" });
    world.clock.now = NOW + DAY;

    const set = await updateSite(world.install, OWNER, { site: id, search_engines: true, embeddable: false, expires: "7d" });
    const cleared = await updateSite(world.install, OWNER, { site: id, title: "", expires: "2030-01-01" });
    const again = await updateSite(world.install, OWNER, { site: id, title: null });

    expect(set).toMatchObject({ ok: true, site: { title: "First", search_engines: true, embeddable: false, expires: NOW + 8 * DAY, access: "private" } });
    expect(cleared).toMatchObject({ ok: true, site: { title: null, search_engines: true, embeddable: false, expires: Date.UTC(2030, 0, 1) } });
    expect(again).toMatchObject({ ok: true, before: { title: null }, site: { title: null, expires: Date.UTC(2030, 0, 1) } });
    expect(await world.audit()).toEqual(["create", "details", "details"]);
  });

  // Drift: each row is a change that must not happen; one that was applied half would leave a site in a state nobody asked for.
  test.each([
    ["nothing to change", {}, { code: "bad_argument", about: "settings" }],
    ["an access that is none", { access: "open" }, { code: "bad_argument", about: "access" }],
    ["a public name with no public access", { public_name: "docs" }, { code: "bad_argument", about: "public_name" }],
    ["a public name that breaks the name rules", { access: "public", public_name: "My Docs" }, { code: "bad_name", about: "public_name" }],
    ["the gallery's public name", { access: "public", public_name: "gallery" }, { code: "reserved_name", about: "public_name" }],
    ["a title that is no text", { title: 3 }, { code: "bad_argument", about: "title" }],
    ["an expiry that has passed", { title: "kept out", expires: "2020-01-01" }, { code: "bad_argument", about: "expires" }],
    ["a day no month has", { expires: "2030-02-31" }, { code: "bad_argument", about: "expires" }],
    ["a span of nothing", { expires: "0d" }, { code: "bad_argument", about: "expires" }],
    ["a span that ends past the last moment a date holds", { expires: "100000000d" }, { code: "bad_argument", about: "expires" }],
    ["a title with a line break", { title: "two\nlines" }, { code: "bad_argument", about: "title" }],
    ["a title with a control character", { title: "a\u0000b" }, { code: "bad_argument", about: "title" }],
    ["a title with a line separator", { title: "two\u2028lines" }, { code: "bad_argument", about: "title" }],
    ["a held public name beside a title", { access: "public", public_name: "taken", title: "kept out" }, { code: "name_taken", about: "public_name" }],
  ] as readonly (readonly [string, Changes, object])[])("a change with %s is refused and leaves the site as it was", async (_why, changes, refusal) => {
    const world = await makeWorld();
    await made(world, ADMIN, "taken", { access: "public" });
    const id = await made(world, OWNER, "report");
    const before = [await getSite(world.install, OWNER, id), await world.audit()];

    expect(await updateSite(world.install, OWNER, { site: id, ...changes })).toEqual({ ok: false, ...refusal } as never);
    expect([await getSite(world.install, OWNER, id), await world.audit()]).toEqual(before);
  });

  // Drift: an access change is one database step; a second step after it could refuse a change that is already made and visible.
  test("an access change alone answers done, though the site gets a new link the moment after", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    const change = world.install.database.changeAccess.bind(world.install.database);
    spyOn(world.install.database, "changeAccess").mockImplementation(async (...parameters) => {
      const changed = await change(...parameters);
      await newLink(world.install, OWNER, id);

      return changed;
    });

    expect(await updateSite(world.install, OWNER, { site: id, access: "public" })).toMatchObject({ ok: true, site: { id, access: "public" } });
    expect(await world.audit()).toEqual(["create", "access", "new_id"]);
  });

  // Drift: a change asked twice is one change; a second audit entry would log a change that never happened.
  test("a change that leaves the site as it is writes no audit entry, and a site in the trash takes no change", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report", { access: "unlisted" });
    const same = await updateSite(world.install, OWNER, { site: id, access: "unlisted", embeddable: true });
    await deleteSite(world.install, OWNER, { site: id });

    expect(same).toMatchObject({ ok: true, site: { access: "unlisted" } });
    expect(await updateSite(world.install, OWNER, { site: id, title: "late" })).toEqual({ ok: false, code: "in_trash" });
    expect(await world.audit()).toEqual(["create", "trash"]);
  });
});
