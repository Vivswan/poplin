import { describe, expect, test } from "bun:test";

import { listAudit } from "../../../src/actions/install/audit-log";
import { changeConfig, readConfig } from "../../../src/actions/install/config";
import { updateSite } from "../../../src/actions/sites/set";
import { ADMIN, made, makeWorld, NOW, OWNER } from "../support/actions-fixture";

describe("changeConfig", () => {
  // Drift: a setting is replaced whole and alone; a change that rewrote the others would undo a setting made a moment before.
  test("an admin reads every setting and changes some: the rest stay, and a change that changes nothing writes no audit entry", async () => {
    const world = await makeWorld();
    const before = await readConfig(world.install, ADMIN);
    if (!before.ok) throw new Error("the settings were refused");

    const changed = await changeConfig(world.install, ADMIN, { outside_pages: "allowed", block_bots: "off", versions_kept: 10 });
    const same = await changeConfig(world.install, ADMIN, { versions_kept: 10 });

    expect(changed).toEqual({ ok: true, values: { ...before.values, outside_pages: "allowed", block_bots: "off", versions_kept: 10 } });
    expect([same, await readConfig(world.install, ADMIN)]).toEqual([changed, changed]);
    expect(await world.audit()).toEqual(["settings_changed"]);
  });

  // Drift: the settings bound what every publish may do; a value outside its rule, once stored, would be read back by every action after it.
  test.each([
    ["no key", {}, "settings"],
    ["no object", "versions_kept=10", "settings"],
    ["a key that is no setting", { colour: "red" }, "colour"],
    ["a count below one", { versions_kept: 0 }, "versions_kept"],
    ["an empty list of users", { users: [] }, "users"],
    ["a size in no known unit", { max_site_size: { count: 1, unit: "TB" } }, "max_site_size"],
    ["a word that is no choice", { outside_pages: "open" }, "outside_pages"],
  ] as const)("a change with %s is refused and leaves the settings as they were", async (_why, changes, about) => {
    const world = await makeWorld();
    const before = await readConfig(world.install, ADMIN);

    expect(await changeConfig(world.install, ADMIN, changes)).toEqual({ ok: false, code: "bad_argument", about });
    expect([await readConfig(world.install, ADMIN), await world.audit()]).toEqual([before, []]);
  });

  // Drift: the settings hold the users and the limits; a publisher token that could read or change them would be an admin in all but name.
  test("a publisher neither reads nor changes the settings, nor reads the audit log", async () => {
    const world = await makeWorld();

    expect([await readConfig(world.install, OWNER), await changeConfig(world.install, OWNER, { versions_kept: 10 }), await listAudit(world.install, OWNER)]).toEqual([
      { ok: false, code: "not_allowed" },
      { ok: false, code: "not_allowed" },
      { ok: false, code: "not_allowed" },
    ]);
    expect(await world.audit()).toEqual([]);
  });

  // Drift: a kind is a list of actions the log keeps; an action left out of its kind would be missing from the Activity page under that filter and nowhere else.
  test("the log is read by kind and by a site's name, and a kind or a name it does not take is refused by its key", async () => {
    const world = await makeWorld();
    const site = await made(world, ADMIN, "report");
    await changeConfig(world.install, ADMIN, { versions_kept: 10 });
    await updateSite(world.install, ADMIN, { site, access: "unlisted" });
    const told = async (query: Parameters<typeof listAudit>[2]): Promise<unknown> => {
      const listed = await listAudit(world.install, ADMIN, query);

      return listed.ok ? listed.entries.map((entry) => entry.action) : listed;
    };

    expect([await told({ kind: "sites" }), await told({ kind: "settings" }), await told({ kind: "access" }), await told({ site: "epo" }), await told({ site: "none" })]).toEqual([
      ["access", "create"],
      ["settings_changed", "settings_set"],
      [],
      ["access", "create"],
      [],
    ]);
    expect([await told({ kind: "all" as never }), await told({ site: "" }), await told({ site: "a".repeat(41) })]).toEqual([
      { ok: false, code: "bad_argument", about: "kind" },
      { ok: false, code: "bad_argument", about: "site" },
      { ok: false, code: "bad_argument", about: "site" },
    ]);
  });
});

describe("listAudit", () => {
  // Drift: the Activity tab pages through the log by `after`; an entry that lost its site or its actor here would be a line nobody can read.
  test("an admin reads the log newest first, each entry with who, when, and which site, and pages it by `after`", async () => {
    const world = await makeWorld();
    const id = await made(world, OWNER, "report");
    await changeConfig(world.install, ADMIN, { versions_kept: 10 });

    const newest = await listAudit(world.install, ADMIN, { limit: 1 });
    const older = await listAudit(world.install, ADMIN, { after: 3 });

    expect(newest).toEqual({ ok: true, entries: [{ seq: 3, at: NOW, by: ADMIN.holder, action: "settings_changed", site: null, detail: { versions_kept: 10 } }] });
    expect(older).toEqual({
      ok: true,
      entries: [
        { seq: 2, at: NOW, by: OWNER.holder, action: "create", site: { id, name: "report" }, detail: { access: "private", public_name: null } },
        { seq: 1, at: NOW, by: ADMIN.holder, action: "settings_set", site: null, detail: {} },
      ],
    } as never);
    expect(await listAudit(world.install, ADMIN, { limit: 101 })).toEqual({ ok: false, code: "bad_argument", about: "limit" });
  });

  // Drift: the direction and the cursor are one query; a direction the action dropped, or took for a filter alone, would show the first page again under "oldest first".
  test.each([
    ["the newest first when no direction is asked", {}, [["access"], ["settings_changed"], ["create"], ["settings_set"]]],
    ["the newest first", { dir: "desc" }, [["access"], ["settings_changed"], ["create"], ["settings_set"]]],
    ["the oldest first", { dir: "asc" }, [["settings_set"], ["create"], ["settings_changed"], ["access"]]],
    ["one kind, the newest first", { dir: "desc", kind: "sites" }, [["access"], ["create"]]],
    ["one kind, the oldest first", { dir: "asc", kind: "sites" }, [["create"], ["access"]]],
    ["one site, the newest first", { dir: "desc", site: "epo" }, [["access"], ["create"]]],
    ["one site, the oldest first", { dir: "asc", site: "epo" }, [["create"], ["access"]]],
  ] as const)("the log is read %s, a page of one after another", async (_name, query, outcome) => {
    const world = await makeWorld();
    const site = await made(world, ADMIN, "report");
    await changeConfig(world.install, ADMIN, { versions_kept: 10 });
    await updateSite(world.install, ADMIN, { site, access: "unlisted" });
    const pages: string[][] = [];
    let after: number | undefined;

    for (;;) {
      const listed = await listAudit(world.install, ADMIN, { limit: 1, ...query, after });
      if (!listed.ok) throw new Error(`the log was refused: ${listed.code}`);

      const last = listed.entries.at(-1);
      if (last === undefined) break;

      pages.push(listed.entries.map((entry) => entry.action));
      after = last.seq;
    }

    expect<unknown>(pages).toEqual(outcome);
  });
});
