import { describe, expect, test } from "bun:test";

import { readConfig } from "../../../src/actions/install/config";
import { exportSettings } from "../../../src/actions/backup/export";
import { importSettings } from "../../../src/actions/backup/import-settings";
import type { Login } from "../../../src/auth/logins";
import { ADMIN, makeWorld, OWNER } from "../support/actions-fixture";

/** The settings of another install as its export gives them: its own users, one of them chosen for the alerts, and three values this install does not have. */
async function backup(): Promise<{ format: number; settings: Record<string, string> }> {
  const other = await makeWorld({ users: ["bo@example.com" as Login, "ada@example.com" as Login], alert_users: ["bo@example.com" as Login], trash_days: 30, max_sites: 12, block_bots: "off" });
  const exported = await exportSettings(other.install, ADMIN);
  if (!exported.ok) throw new Error(`the fixture export was refused: ${exported.code}`);

  return { format: exported.format, settings: { ...exported.settings } };
}

describe("importSettings", () => {
  // Drift: the users say who may sign in; a backup's users laid over this install's would shut out the admin who ran the import, with no way back but the database.
  // The users the alerts go to are chosen among the users: a backup's, laid over users they are none of, would be refused, so they come and stay with the users.
  test("a backup's settings replace this install's, and its users, with who its alerts go to, only when they are asked for by name", async () => {
    const world = await makeWorld();
    const sent = await backup();

    const kept = await importSettings(world.install, ADMIN, sent);
    const audit = await world.audit();
    const taken = await importSettings(world.install, ADMIN, { ...sent, users: true });

    expect(kept).toMatchObject({ ok: true, values: { users: ["ada@example.com"], alert_users: [], trash_days: 30, max_sites: 12, block_bots: "off" } });
    expect<unknown>([audit, taken.ok && [taken.values.users, taken.values.alert_users], await readConfig(world.install, ADMIN)]).toEqual([["settings_changed"], [["bo@example.com", "ada@example.com"], ["bo@example.com"]], taken]);
  });

  // Drift: each row is a backup this install cannot read whole; one that was applied in part would leave settings no admin chose.
  test.each([
    ["a publisher", OWNER, {}, { ok: false, code: "not_allowed" }],
    ["a backup of a newer format", ADMIN, { format: 2 }, { ok: false, code: "backup_too_new", about: "format" }],
    ["a format below one", ADMIN, { format: 0 }, { ok: false, code: "bad_argument", about: "format" }],
    ["no format", ADMIN, { format: undefined }, { ok: false, code: "bad_argument", about: "format" }],
    ["a key that is no setting", ADMIN, { settings: { colour: "red" } }, { ok: false, code: "bad_argument", about: "colour" }],
    ["a setting left out", ADMIN, { settings: {} }, { ok: false, code: "bad_argument", about: "default_expires" }],
    ["a field no import takes", ADMIN, { overwrite: true }, { ok: false, code: "bad_argument", about: "overwrite" }],
  ] as const)("%s is refused, and no setting changes", async (_what, actor, change, refusal) => {
    const world = await makeWorld();
    const before = await readConfig(world.install, ADMIN);
    const sent = await backup();

    expect(await importSettings(world.install, actor, { ...sent, ...change } as never)).toEqual(refusal);
    expect([await readConfig(world.install, ADMIN), await world.audit()]).toEqual([before, []]);
  });

  // Drift: a text of a setting is typed by people into a zip; one this install's rules refuse must stop the whole import, since the keys before it would be written otherwise.
  test("a value in a form or a range the setting does not take is refused by its key, with every setting as it was", async () => {
    const world = await makeWorld();
    const before = await readConfig(world.install, ADMIN);
    const { format, settings } = await backup();

    const answers = [
      await importSettings(world.install, ADMIN, { format, settings: { ...settings, max_site_size: "5 megabytes" } }),
      await importSettings(world.install, ADMIN, { format, settings: { ...settings, versions_kept: "0" } }),
    ];

    expect(answers).toEqual([
      { ok: false, code: "bad_argument", about: "max_site_size" },
      { ok: false, code: "bad_argument", about: "versions_kept" },
    ]);
    expect(await readConfig(world.install, ADMIN)).toEqual(before);
  });
});
