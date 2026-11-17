import { describe, expect, test } from "bun:test";

import { domainState } from "../../../src/actions/install/domain-state";
import { signedBy } from "../../../src/actions/access/reach";
import type { Login } from "../../../src/auth/logins";
import type { CheckedPiece, DomainCheck } from "../../../src/records/domain-check";
import { ADMIN, DAY, makeWorld, NOW } from "../support/actions-fixture";

/** The pieces of a small install, by a short name each: two of the login, two that make a site answer, and two others. */
const PIECE = {
  login: { piece: "Login application", detail: "the dashboard's login", part: "login" },
  policy: { piece: "Login policy", detail: "the logins of the settings", part: "login" },
  record: { piece: "Record", detail: "every site", part: "reach" },
  route: { piece: "Route", detail: "every site", part: "reach" },
  rule: { piece: "Rate rule", detail: "sample-rate-rule", part: "rest" },
  bots: { piece: "Bot settings", detail: "bots", part: "rest" },
} as const;

type Name = keyof typeof PIECE;

/** What a piece is remembered as, in the short words of the table below. */
const AS = {
  ok: { state: "ok" },
  broken: { state: "needs_repair" },
  optional: { state: "not_set_up" },
  failed: { state: "unread", reason: "failed" },
  unreached: { state: "unread", reason: "not_run" },
  rightless: { state: "unread", reason: "missing_right", right: "Rules: Edit" },
} as const;

/** Every piece ok, but the ones a row names. */
function pieces(others: Partial<Record<Name, keyof typeof AS>>): CheckedPiece[] {
  return (Object.keys(PIECE) as Name[]).map((name) => ({ ...PIECE[name], ...AS[others[name] ?? "ok"] }));
}

/** Keep a run that ran `ago` milliseconds before the fixture moment, and answer what the install then says of its domain. */
async function stateAfter(found: readonly CheckedPiece[], ago = 0): Promise<{ readonly check: DomainCheck; readonly answer: Awaited<ReturnType<typeof domainState>> }> {
  const world = await makeWorld();
  const check: DomainCheck = { ran_at: NOW - ago, by: ADMIN.holder, run: "check", pieces: [...found] };
  await world.install.database.keepDomainCheck(check, {});

  return { check, answer: await domainState(world.install, ADMIN) };
}

describe("domainState", () => {
  // Drift: the note is the one line a person is told of the domain. Each row is a run that must raise exactly this note: a wrong order would say "a piece is missing" while private sites are locked, and a note for an optional piece would never go away.
  test.each<{ readonly name: string; readonly found: Partial<Record<Name, keyof typeof AS>>; readonly note: unknown }>([
    { name: "every piece ok", found: {}, note: "none" },
    { name: "only optional pieces left out", found: { rule: "optional", bots: "optional" }, note: "none" },
    { name: "the login broken", found: { login: "broken" }, note: { code: "login_broken", about: "Login application" } },
    { name: "the login's second piece broken", found: { policy: "broken" }, note: { code: "login_broken", about: "Login policy" } },
    { name: "a record broken", found: { record: "broken" }, note: { code: "sites_unreachable", about: "Record" } },
    { name: "a route broken", found: { route: "broken" }, note: { code: "sites_unreachable", about: "Route" } },
    { name: "another piece broken", found: { bots: "broken" }, note: { code: "needs_repair", about: "Bot settings" } },
    { name: "the login broken after a record and a rule", found: { record: "broken", rule: "broken", policy: "broken" }, note: { code: "login_broken", about: "Login policy" } },
    { name: "a record broken after a rule", found: { rule: "broken", route: "broken" }, note: { code: "sites_unreachable", about: "Route" } },
    { name: "a piece that failed", found: { rule: "failed" }, note: { code: "not_read", about: "Rate rule" } },
    { name: "a piece the token had no right for", found: { rule: "rightless" }, note: { code: "not_read", about: "Rate rule" } },
    { name: "pieces a run never reached", found: { route: "failed", login: "unreached", policy: "unreached" }, note: { code: "not_read", about: "Login application" } },
    { name: "a broken piece beside an unread login", found: { login: "failed", bots: "broken" }, note: { code: "needs_repair", about: "Bot settings" } },
    { name: "an unread piece beside an optional one", found: { rule: "optional", bots: "unreached" }, note: { code: "not_read", about: "Bot settings" } },
  ])("$name raises $note", async ({ found, note }) => {
    const { check, answer } = await stateAfter(pieces(found));

    expect<unknown>(answer).toEqual({ ok: true, check, age: 0, stale: false, waits: false, note });
  });

  // Drift: the record is a memory of one run. Shown as the state now a month on, it would alarm a person about a login they mended at the provider long ago, or keep quiet about its own age.
  test.each([
    { name: "30 days old, broken", ago: 30 * DAY, found: { login: "broken" }, stale: false, note: { code: "login_broken", about: "Login application" } },
    { name: "a millisecond over 30 days, broken", ago: 30 * DAY + 1, found: { login: "broken" }, stale: true, note: { code: "check_again", about: null } },
    { name: "a year old, unread", ago: 365 * DAY, found: { rule: "failed" }, stale: true, note: { code: "check_again", about: null } },
    { name: "a year old, every piece ok", ago: 365 * DAY, found: {}, stale: true, note: "none" },
    { name: "kept by a clock ahead of this one", ago: -DAY, found: { record: "broken" }, stale: false, note: { code: "sites_unreachable", about: "Record" } },
  ] as const)("a run $name is stale: $stale, and raises $note", async ({ ago, found, stale, note }) => {
    const { answer } = await stateAfter(pieces(found), ago);

    expect(answer).toMatchObject({ age: Math.max(0, ago), stale, note });
  });

  // Drift: a user added in Access cannot log in until a repair. Outranked by a rule piece, or dropped with an old run, the one line a person reads would send them to the wrong thing or to nothing.
  test.each([
    { name: "every piece ok", ago: 0, found: {}, note: { code: "users_changed", about: null } },
    { name: "the login broken", ago: 0, found: { login: "broken" }, note: { code: "login_broken", about: "Login application" } },
    { name: "a record broken", ago: 0, found: { record: "broken" }, note: { code: "sites_unreachable", about: "Record" } },
    { name: "another piece broken", ago: 0, found: { bots: "broken" }, note: { code: "users_changed", about: null } },
    { name: "a piece unread", ago: 0, found: { rule: "failed" }, note: { code: "users_changed", about: null } },
    { name: "a year old, the login broken", ago: 365 * DAY, found: { login: "broken" }, note: { code: "users_changed", about: null } },
    { name: "a year old, every piece ok", ago: 365 * DAY, found: {}, note: { code: "users_changed", about: null } },
  ] as const)("users changed after a run with $name raise $note, until a repair settles them", async ({ ago, found, note }) => {
    const world = await makeWorld();
    const check: DomainCheck = { ran_at: NOW - ago, by: ADMIN.holder, run: "repair", pieces: pieces(found) };
    await world.install.database.keepDomainCheck(check, {});
    await world.install.database.addLogin("bo@example.com" as Login, signedBy(ADMIN, NOW));
    const waiting = await domainState(world.install, ADMIN);
    await world.install.database.keepDomainCheck(check, {}, { logins: (await world.install.database.readSettings())?.logins ?? [], since: NOW });

    expect<unknown>([waiting, await domainState(world.install, ADMIN)]).toMatchObject([
      { check, waits: true, note },
      { check, waits: false },
    ]);
  });
});
