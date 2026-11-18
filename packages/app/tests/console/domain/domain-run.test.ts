import { expect, test } from "bun:test";

import { runDomain } from "../../../src/console/domain/domain-run";
import { markedIn } from "../../../src/console/problems/problems-routes";
import { openOwned } from "../support/install";
import type { DomainRow } from "../../../src/console/domain/records";
import { fakePlug, TOKEN } from "../support/fake-plug";

/** One row of every state a plug can answer, the failed one twice: once for a missing right, once for another reason. */
const EVERY_STATE: readonly DomainRow[] = [
  { object: "Record", state: "present", detail: "every site", part: "reach" },
  { object: "Record", state: "created", detail: "the dashboard", part: "reach" },
  { object: "Route", state: "changed", detail: "every site", part: "reach" },
  { object: "Route", state: "removed", detail: "an old route", part: "reach" },
  { object: "Login application", state: "missing", detail: "the dashboard's login", part: "login" },
  { object: "Login policy", state: "differs", detail: "the users of the settings", part: "login" },
  { object: "Rate rule", state: "left-out", detail: "rate rule: the plan has none", part: "rest" },
  { object: "Route", state: "left-out", detail: "every site: another application holds it", part: "reach" },
  { object: "Bot settings", state: "optional", detail: "To switch this on, add this permission: Bots: Edit", part: "rest" },
  { object: "Bots rule", state: "failed", detail: "refused. Add this permission to the account token: Rules: Edit", part: "rest", right: "Rules: Edit" },
  { object: "Redirect", state: "failed", detail: "no answer", part: "rest" },
  { object: "Database", state: "not-run", detail: "", part: "rest" },
];

/** The settings of a test install and a run asked of it by its owner. */
async function openRun() {
  const opened = await openOwned();
  const settings = await opened.install.database.readSettings();
  if (settings === undefined) throw new Error("the settings are not stored");

  const asked = { run: "check", token: TOKEN, settings: async () => settings, by: opened.owner } as const;

  const synced = async (): Promise<number> => (await opened.audit()).filter((entry) => entry.action === "domain_synced").length;

  return { opened, asked, synced, kept: () => opened.install.database.readDomainCheck() };
}

// Drift: the note the install raises about its domain is derived from what is kept here. A state kept as another would call a repaired install broken, or a piece that failed fine.
test("a run is kept as the last check of the domain: when, by whom, which run, and each row as ok, needs repair, not set up, or unread; a record or route that was left out needs repair, a rule that was left out does not", async () => {
  const { opened, asked, kept, synced } = await openRun();
  const before = await kept();
  await runDomain(fakePlug(() => ({ ok: true, rows: EVERY_STATE, steps: [] })), opened.install, { ...asked, run: "repair" });

  expect([before, await kept()]).toEqual([
    undefined,
    {
      ran_at: opened.install.now(),
      by: opened.owner,
      run: "repair",
      users_changed_at: null,
      rules_changed_at: null,
      alerts_changed_at: null,
      pieces: [
        { piece: "Record", detail: "every site", part: "reach", state: "ok" },
        { piece: "Record", detail: "the dashboard", part: "reach", state: "ok" },
        { piece: "Route", detail: "every site", part: "reach", state: "ok" },
        { piece: "Route", detail: "an old route", part: "reach", state: "ok" },
        { piece: "Login application", detail: "the dashboard's login", part: "login", state: "needs_repair" },
        { piece: "Login policy", detail: "the users of the settings", part: "login", state: "needs_repair" },
        { piece: "Rate rule", detail: "rate rule: the plan has none", part: "rest", state: "not_set_up" },
        { piece: "Route", detail: "every site: another application holds it", part: "reach", state: "needs_repair" },
        { piece: "Bot settings", detail: "To switch this on, add this permission: Bots: Edit", part: "rest", state: "not_set_up" },
        { piece: "Bots rule", detail: "refused. Add this permission to the account token: Rules: Edit", part: "rest", state: "unread", reason: "missing_right", right: "Rules: Edit" },
        { piece: "Redirect", detail: "no answer", part: "rest", state: "unread", reason: "failed" },
        { piece: "Database", detail: "", part: "rest", state: "unread", reason: "not_run" },
      ],
    },
  ]);
  expect(await synced()).toBe(1);
});

// Drift: the domain's login lets in the users of the last repair that reached it. Settled by a check, a repair that left the login undone, or one that began before the user was added, a new user is locked out and no screen says why.
// An object outside the login can hold a user too, such as the address a warning is mailed to: settled by a repair whose token had no right for it, it would go on naming a user who was removed.
test.each([
  { name: "a check", run: "check", login: "present", holder: "present", method: "present", addedAfter: 0, waits: true },
  { name: "a repair that left the login undone", run: "repair", login: "failed", holder: "present", method: "present", addedAfter: 0, waits: true },
  { name: "a repair under way when the user was added", run: "repair", login: "changed", holder: "present", method: "present", addedAfter: 1, waits: true },
  { name: "a repair that changed the login", run: "repair", login: "changed", holder: "changed", method: "present", addedAfter: 0, waits: false },
  { name: "a repair that found the login standing", run: "repair", login: "present", holder: "present", method: "present", addedAfter: 0, waits: false },
  { name: "a repair with no right for another object that holds the users", run: "repair", login: "changed", holder: "optional", method: "present", addedAfter: 0, waits: true },
  { name: "a repair that failed at another object that holds the users", run: "repair", login: "present", holder: "failed", method: "present", addedAfter: 0, waits: true },
  { name: "a repair that wrote the login and failed after it, though nothing waited before", run: "repair", login: "changed", holder: "failed", method: "present", addedAfter: -1, waits: true },
  { name: "a repair that changed the login, beside an optional login method that is not set up", run: "repair", login: "changed", holder: "changed", method: "optional", addedAfter: 0, waits: false },
] as const)("users that changed still wait after $name: $waits", async ({ run, login, holder, method, addedAfter, waits }) => {
  const { opened, asked, kept } = await openRun();
  const rows: DomainRow[] = [
    { object: "Record", state: "missing", detail: "every site", part: "reach" },
    { object: "Login policy", state: login, detail: "the users", part: "login", users: true },
    { object: "Login method", state: method, detail: "a way to log in", part: "login" },
    { object: "Cost warning", state: holder, detail: "mailed to the first user", part: "rest", users: true },
    { object: "Bots rule", state: "optional", detail: "no right for it", part: "rest" },
  ];
  await runDomain(fakePlug(() => ({ ok: true, rows: [], steps: [] })), opened.install, asked);
  // The plug is slow: the clock moves on while it works.
  const slow = fakePlug(() => {
    opened.clock.now += 5;

    return { ok: true, rows, steps: [] };
  });
  // A user added after the run began is one the run read no settings of: the plug adds it while it works.
  const late = addedAfter > 0;
  const add = (): Promise<unknown> => opened.install.database.addLogin("bo@example.com" as typeof opened.owner, { as: "person", by: opened.owner, at: opened.install.now() });
  if (addedAfter === 0) await add();
  const settings = async (): Promise<Awaited<ReturnType<typeof asked.settings>>> => {
    const read = await opened.install.database.readSettings();
    if (read === undefined) throw new Error("the settings are not stored");
    if (late) await add();

    return read;
  };
  await runDomain(slow, opened.install, { ...asked, run, settings });

  const remembered = await kept();

  expect([remembered?.run, remembered?.users_changed_at === null]).toEqual([run, !waits]);
});

// Drift: the problem of a login that could not be checked says "press Check". Left standing after a check that found the login in order, the Domain screen and its mark in the side menu would go on asking for a day for what was just done.
test("a check that finds the login standing takes the login's problem out of what the frame marks, at once, and leaves a problem no check mends", async () => {
  const { opened, asked } = await openRun();
  const { database, now } = opened.install;
  for (const kind of ["login_unchecked", "sweep_failed"] as const) await database.noteProblem({ kind, at: now(), count: 1, more: false, name: null, message: null });
  const marked = async (): Promise<unknown> => {
    const { recent, marks } = markedIn((await database.readFrame(now())).problems, now(), { screen: true, says: null });

    return [marks.domain, recent.map((problem) => problem.kind).sort()];
  };
  const before = await marked();
  await runDomain(fakePlug(() => ({ ok: true, rows: [{ object: "Login application", state: "present", detail: "the dashboard's login", part: "login" }], steps: [] })), opened.install, asked);

  expect([before, await marked()]).toEqual([
    [{ count: 1, says: "The login could not be checked" }, ["login_unchecked", "sweep_failed"]],
    [null, ["sweep_failed"]],
  ]);
});

// Drift: the token is a key to the whole account at the provider, and the kept run is answered to every admin who asks. A plug that hands the token back in any text, however long, must leave no byte of it in what the install stores.
test("the kept run holds nothing of the token, even from a plug that hands it back in every text and in texts longer than are kept", async () => {
  const { opened, asked, kept } = await openRun();
  const echoing = fakePlug((_run, token) => ({
    ok: true,
    rows: [
      { object: `Record ${token}`, state: "failed", detail: `refused for Bearer ${token}`, part: "reach", right: `${token}: Edit` },
      { object: "x".repeat(95) + token, state: "missing", detail: "y".repeat(590) + token, part: "login" },
    ],
    steps: [],
  }));
  await runDomain(echoing, opened.install, asked);
  const stored = JSON.stringify([await kept(), await opened.audit()]);

  expect([stored.includes(TOKEN), stored.includes(TOKEN.slice(0, 8)), stored.includes("[token]")]).toEqual([false, false, true]);
});

// Drift: a provider with hundreds of stale records answers more rows than are kept. Cut from the end, the run would lose the broken login behind them and the install would call itself healthy.
test("of a run of more rows than are kept, the rows that stand give way first, and of the rows to act on the login's and then the records' and routes' stay", async () => {
  const { opened, asked, kept } = await openRun();
  const records = (state: DomainRow["state"], from: number): DomainRow[] => Array.from({ length: 150 }, (_row, at) => ({ object: "Record", state, detail: `record ${from + at}`, part: "reach" }));
  const broken: DomainRow = { object: "Login application", state: "missing", detail: "the dashboard's login", part: "login" };
  const rule: DomainRow = { object: "Rate rule", state: "missing", detail: "rate rule", part: "rest" };
  await runDomain(fakePlug(() => ({ ok: true, rows: [...records("present", 0), ...records("differs", 150), ...records("differs", 300), rule, broken], steps: [] })), opened.install, asked);
  const pieces = (await kept())?.pieces ?? [];

  // The login first, then what makes a site answer, in the run's order; the rule and every record that stood gave way.
  expect([pieces.length, pieces[0]?.detail, pieces.at(-2)?.detail, pieces.at(-1)]).toEqual([200, "record 150", "record 348", { piece: "Login application", detail: "the dashboard's login", part: "login", state: "needs_repair" }]);
});

// Drift: a run that judged nothing knows nothing. Kept as an empty run it would wipe the note of a broken login, and a person would read the silence as health.
test("a run that is refused or that the plug throws on keeps nothing: the run kept before stays the last one", async () => {
  const { opened, asked, kept, synced } = await openRun();
  await runDomain(fakePlug(() => ({ ok: true, rows: EVERY_STATE, steps: [] })), opened.install, asked);
  const first = await kept();
  opened.clock.now += 60_000;

  for (const refusal of ["token", "unreachable"] as const) await runDomain(fakePlug(() => ({ ok: false, refusal })), opened.install, asked);
  const thrown = runDomain(fakePlug(() => { throw new Error("the provider's answer could not be read"); }), opened.install, asked);
  await expect(thrown).rejects.toThrow();

  expect([first?.pieces.length, await kept(), await synced()]).toEqual([12, first, 1]);
});

test("every text of a reading has the token taken out before anything is shown or written, and an empty token changes no text", async () => {
  const opened = await openOwned();
  const settings = await opened.install.database.readSettings();
  if (settings === undefined) throw new Error("the settings are not stored");

  const plug = fakePlug((_run, token) => ({
    ok: true,
    rows: [{ object: `a${token}b`, state: "failed", detail: `${token}${token}`, part: "rest" }],
    steps: [{ text: `open ${token}`, address: `https://dash.example.com/${token}` }],
  }));
  const asked = { run: "repair", settings: async () => settings, by: opened.owner } as const;

  expect(await runDomain(plug, opened.install, { ...asked, token: TOKEN })).toEqual({
    ok: true,
    rows: [{ object: "a[token]b", state: "failed", detail: "[token][token]", part: "rest" }],
    steps: [{ text: "open [token]", address: "https://dash.example.com/[token]" }],
  });
  expect((await opened.audit())[0]?.detail).toEqual({ run: "repair", from: "dashboard", failed: ["a[token]b: [token][token]"] });
  expect(await runDomain(plug, opened.install, { ...asked, token: "" })).toMatchObject({ rows: [{ object: "ab", detail: "" }] });
});

test("a reading that is no table is handed on as it is and writes no audit entry: a refused token did nothing worth a line", async () => {
  const opened = await openOwned();
  const settings = await opened.install.database.readSettings();
  if (settings === undefined) throw new Error("the settings are not stored");

  const before = await opened.audit();

  for (const refusal of ["token", "unreachable"] as const) {
    const reading = await runDomain(
      fakePlug(() => ({ ok: false, refusal })),
      opened.install,
      { run: "check", token: TOKEN, settings: async () => settings, by: opened.owner },
    );

    expect(reading).toEqual({ ok: false, refusal });
  }

  expect(await opened.audit()).toEqual(before);
});
