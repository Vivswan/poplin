import { describe, expect, test } from "bun:test";

import { changeConfig, readConfig } from "../../../src/actions/install/config";
import { exportSettings } from "../../../src/actions/backup/export";
import { importSettings } from "../../../src/actions/backup/import-settings";
import type { Login } from "../../../src/auth/logins";
import type { Actor } from "../../../src/auth/scopes";
import type { TokenId } from "../../../src/auth/tokens";
import { ADMIN, makeWorld, rehearsedThenRun } from "../support/actions-fixture";

const TOKEN: Actor = { scope: "admin", holder: "00000000000000cc" as TokenId };
const ADA = "ada@example.com" as Login;
const BO = "bo@example.com" as Login;
const CY = "cy@example.com" as Login;

describe("a change of the update settings", () => {
  const REFUSED = { ok: false, code: "needs_update_check", about: "auto_update" };

  // Drift: the dashboard locks the switch, and the API, the CLI and an agent do not go through it. Each row is one request of theirs that would leave an install set to update by itself and never asking for a release.
  test.each([
    { name: "automatic updates on while the check is off", stored: { update_check: false }, change: { auto_update: true } },
    { name: "the check off while automatic updates are on", stored: { auto_update: true }, change: { update_check: false } },
    { name: "both in one change", stored: {}, change: { update_check: false, auto_update: true } },
  ])("$name is refused by name, and nothing of the change is stored", async ({ stored, change }) => {
    const world = await makeWorld(stored);
    const refused = await changeConfig(world.install, TOKEN, { ...change, trash_days: 9 });
    const after = await readConfig(world.install, ADMIN);

    expect<unknown>([refused, after.ok && after.values.trash_days, await world.audit()]).toEqual([REFUSED, 7, []]);
  });

  test("drift: a rule that refused the way out would lock the pair: the check goes off together with automatic updates, and both go on together", async () => {
    const world = await makeWorld({ auto_update: true });
    const changes = [{ update_check: false, auto_update: false }, { update_check: true, auto_update: true }];
    const stored: unknown[] = [];
    for (const change of changes) stored.push(await changeConfig(world.install, TOKEN, change));

    expect(stored).toMatchObject(changes.map((values) => ({ ok: true, values })));
  });

  // Drift: a backup is text a person can edit, and an import replaces every setting at once, so the store never compares it with a pair it holds.
  test("a backup that holds automatic updates on with the check off is refused by the same name", async () => {
    const world = await makeWorld();
    const exported = await exportSettings(world.install, ADMIN);
    if (!exported.ok) throw new Error("the export was refused");

    const refused = await importSettings(world.install, TOKEN, { format: exported.format, settings: { ...exported.settings, update_check: "off", auto_update: "on" } });

    expect<unknown>([refused, await world.audit()]).toEqual([REFUSED, []]);
  });
});

describe("a change of the logins", () => {
  const cases: readonly { readonly name: string; readonly by: Actor; readonly stored: readonly Login[]; readonly next: readonly Login[]; readonly kept: boolean }[] = [
    { name: "an admin at the dashboard adds an email beside their own", by: ADMIN, stored: [ADA], next: [ADA, BO], kept: true },
    { name: "an admin at the dashboard takes another email out", by: ADMIN, stored: [ADA, BO], next: [ADA], kept: true },
    { name: "an admin at the dashboard takes their own email out and leaves a new one", by: ADMIN, stored: [ADA], next: [BO], kept: false },
    { name: "an admin at the dashboard takes their own email out and leaves one that was a login", by: ADMIN, stored: [ADA, BO], next: [BO], kept: false },
    { name: "a token adds an email", by: TOKEN, stored: [ADA], next: [ADA, BO], kept: true },
    { name: "a token leaves one of two logins", by: TOKEN, stored: [ADA, BO], next: [BO], kept: true },
    { name: "a token leaves new emails alone", by: TOKEN, stored: [ADA], next: [BO, CY], kept: false },
  ];

  // Drift: the login page keeps a list of its own, which a repair from the dashboard brings up to the stored one; stored logins that page lets nobody in with shut the dashboard, and the repair with it.
  test.each(cases)("$name: stored is $kept", async ({ by, stored, next, kept }) => {
    const world = await makeWorld({ logins: [...stored] });
    const changed = await changeConfig(world.install, by, { logins: next, trash_days: 9 });
    const after = await readConfig(world.install, ADMIN);

    expect(changed).toMatchObject(kept ? { ok: true, values: { logins: next, trash_days: 9 } } : { ok: false, code: "no_working_login", about: "logins" });
    expect<unknown>([after.ok && after.values.logins, after.ok && after.values.trash_days, await world.audit()]).toEqual(kept ? [next, 9, ["settings_changed"]] : [stored, 7, []]);
  });

  // Drift: an import with its logins is the other way a list reaches the store; a rule held by `changeConfig` alone would leave a backup of another install to shut this one.
  test("a backup whose logins share none with this install's is refused whole when its logins are asked for, and taken without them", async () => {
    const other = await makeWorld({ logins: [BO], trash_days: 30 });
    const exported = await exportSettings(other.install, { scope: "admin", holder: BO });
    if (!exported.ok) throw new Error("the export was refused");

    const world = await makeWorld();
    const sent = { format: exported.format, settings: { ...exported.settings } };
    const refused = await importSettings(world.install, TOKEN, { ...sent, logins: true });
    const untouched = await readConfig(world.install, ADMIN);
    const taken = await importSettings(world.install, TOKEN, sent);

    expect([refused, untouched.ok && [untouched.values.logins, untouched.values.trash_days]]).toEqual([{ ok: false, code: "no_working_login", about: "logins" }, [[ADA], 7]]);
    expect(taken).toMatchObject({ ok: true, values: { logins: [ADA], trash_days: 30 } });
  });
});

describe("a change of the settings with dry_run", () => {
  // Drift: the settings are patched by the database, and a dry run lays the change over them itself; one that laid it otherwise, or let through a pair or logins the run refuses, would show settings no run stores.
  test("a dry run answers the settings or the refusal the run after it answers, and writes no row", async () => {
    const world = await makeWorld({ logins: [ADA, BO] });
    const asked: readonly unknown[] = [
      { trash_days: 9, versions_kept: 5 },
      { default_expires: { count: 12, unit: "h" } },
      { default_expires: "never", max_sites: 3 },
      { update_check: false },
      { auto_update: false, update_check: false },
      { auto_update: true },
      { logins: [BO, CY] },
      { logins: [CY] },
      { trash_days: 9 },
      { trash_days: undefined, versions_kept: 4 },
      { trash_days: 0 },
      {},
    ];
    const steps = [];
    for (const changes of asked) steps.push(await rehearsedThenRun(world, (how) => changeConfig(world.install, ADMIN, changes, how)));
    const asToken = await rehearsedThenRun(world, (how) => changeConfig(world.install, { scope: "publisher", holder: TOKEN.holder }, { trash_days: 3 }, how));

    expect([...steps, asToken].map((step) => [step.written, step.rehearsal])).toEqual([...steps, asToken].map((step) => [0, step.run]));
    expect([...steps, asToken].map((step) => (step.run.ok ? "stored" : step.run.code))).toEqual(
      ["stored", "stored", "stored", "stored", "stored", "needs_update_check", "no_working_login", "no_working_login", "stored", "stored", "bad_argument", "bad_argument", "not_allowed"],
    );
  });
});
