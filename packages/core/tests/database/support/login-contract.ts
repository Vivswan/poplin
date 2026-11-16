// The part of the database contract about who may come in: tokens and settings, the logins of computers, and the visitor key.

import { describe, expect, test } from "bun:test";

import type { LoginId, PendingLogin } from "../../../src/auth/computer-logins";
import type { Login } from "../../../src/auth/logins";
import { mintToken, type TokenId, type TokenRecord } from "../../../src/auth/tokens";
import type { Signed } from "../../../src/database/database";
import {
  ADA,
  ADMIN,
  BO,
  BY_ADA,
  DOCS,
  type DatabaseFactory,
  FIRST_KEY,
  NOW,
  REPORT,
  ROOM,
  SECOND_KEY,
  SETTINGS,
  THIRD_KEY,
  auditDetails,
  auditTrail,
  draft,
  made,
  opened,
  pendingLogin,
  sizeOf,
} from "./database-fixtures";

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

export function visitorKey(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the visitor key`, () => {
    // Drift: two Workers that each kept their own key would count one visitor under two keys, and let each through twice as often.
    test("starters at the same moment end with one key, a later starter gets it, and nothing changes it", async () => {
      const database = await opened(makeDatabase);
      const none = await database.readVisitorKey();
      const started = await Promise.all([FIRST_KEY, SECOND_KEY, THIRD_KEY].map((fresh) => database.ensureVisitorKey(fresh, NOW)));
      const winner = started.find((start) => start.kind === "created")?.key;
      const later = await database.ensureVisitorKey(new Uint8Array(32).fill(0xd4), NOW + 1);

      expect(none).toBeUndefined();
      expect(started.map((start) => start.kind).sort()).toEqual(["created", "kept", "kept"]);
      expect<unknown>(started.map((start) => start.key)).toEqual([winner, winner, winner]);
      expect<unknown>([FIRST_KEY, SECOND_KEY, THIRD_KEY]).toContainEqual(winner);
      expect<unknown>(later).toEqual({ kind: "kept", key: winner });
      expect(await auditTrail(database)).toEqual([]);
      await expect(database.ensureVisitorKey(new Uint8Array(31), NOW)).rejects.toThrow(RangeError);
      expect<unknown>(await database.readVisitorKey()).toEqual(winner);
    });

    // Drift: a request is checked against both; a joint read that gave either one differently from its own read would count a visitor under another key or trust a removed login.
    test("the settings and the key read together are what each read alone gives: neither before setup, then the one without the other, then both", async () => {
      const database = await opened(makeDatabase);
      const together = [await database.readSettingsAndKey()];
      await database.initSettings(SETTINGS, BY_ADA);
      together.push(await database.readSettingsAndKey());
      await database.ensureVisitorKey(FIRST_KEY, NOW);
      together.push(await database.readSettingsAndKey());

      expect<unknown>(together).toEqual([
        { settings: undefined, key: undefined },
        { settings: SETTINGS, key: undefined },
        { settings: await database.readSettings(), key: await database.readVisitorKey() },
      ]);
      expect<unknown>(together[2]?.key).toEqual(FIRST_KEY);
    });

    // Drift: a backup or a dashboard page that carried the key would let whoever reads it work out the key a visitor is counted under.
    test("no listing, export, settings read, or audit entry holds the key", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      await database.addToken((await mintToken({ scope: "admin", note: "laptop", now: NOW })).record, BY_ADA);
      const site = await made(database, draft(REPORT, "public", DOCS));
      await database.trashSite((await made(database, draft(REPORT))).id, BY_ADA);
      await database.ensureVisitorKey(FIRST_KEY, NOW);

      const shown = JSON.stringify([
        await database.exportSites({ limit: 100 }),
        await database.listSites({ trash: false, limit: 100 }),
        await database.listSites({ trash: true, limit: 100 }),
        await database.getSite(site.id),
        await sizeOf(database, site.id),
        await database.readTotals(),
        await database.readSettings(),
        await database.listTokens(),
        await database.listAudit({ limit: 100 }),
      ]);
      const needles = ["a1".repeat(32), "161,161", '"161"'];

      expect(needles.filter((needle) => shown.includes(needle))).toEqual([]);
      expect<unknown>(await database.readVisitorKey()).toEqual(FIRST_KEY);
    });
  });
}

export function tokensAndSettings(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: tokens and settings`, () => {
    // Drift: a screen writes who published by the token's note. A read that lost the note of a removed token would show its bare id in every row it published, and one that gave an empty note would write nothing there.
    test("the notes of many tokens are read at once, a removed one's too, and nothing for a token with no note or an id that is no token's", async () => {
      const database = await opened(makeDatabase);
      const admin = (await mintToken({ scope: "admin", note: "laptop", now: NOW })).record;
      const removed = (await mintToken({ scope: "publisher", note: "agent", now: NOW })).record;
      const unnamed = (await mintToken({ scope: "publisher", note: "", now: NOW })).record;
      for (const token of [admin, removed, unnamed]) await database.addToken(token, BY_ADA);
      await database.revokeToken(removed.id, BY_ADA);

      const names = await database.getTokenNames([admin.id, removed.id, unnamed.id, BO, admin.id]);

      expect<unknown>([[...names].sort(), [...(await database.getTokenNames([]))]]).toEqual([
        [
          [admin.id, "laptop"],
          [removed.id, "agent"],
        ].sort(),
        [],
      ]);
    });

    // Drift: each id asked is a value bound to a statement, and a database binds only so many to one: the provider's takes 100. A read that bound more would fail there as an error of the engine, on a page that names many tokens.
    test("the notes of more ids than one statement binds are read, the first and the last among them", async () => {
      const database = await opened(makeDatabase);
      const first = (await mintToken({ scope: "publisher", note: "agent", now: NOW })).record;
      const last = (await mintToken({ scope: "publisher", note: "ci", now: NOW })).record;
      for (const token of [first, last]) await database.addToken(token, BY_ADA);
      const none = Array.from({ length: 250 }, (_none, index) => index.toString(16).padStart(16, "0") as TokenId);

      expect<unknown>([...(await database.getTokenNames([first.id, ...none, last.id]))].sort()).toEqual(
        [
          [first.id, "agent"],
          [last.id, "ci"],
        ].sort(),
      );
    });

    // Drift: the record `mintToken` makes is what a presented token is checked against; a field lost on the way through a row would refuse every token.
    test("a minted token's record reads back as minted, lists newest first, and has no record once revoked", async () => {
      const database = await opened(makeDatabase);
      const admin = (await mintToken({ scope: "admin", note: "laptop", now: NOW })).record;
      const publisher = (await mintToken({ scope: "publisher", note: "", now: NOW + 1 })).record;

      const impostor = { ...admin, note: "replacement" };

      expect([await database.addToken(admin, BY_ADA), await database.addToken(publisher, BY_ADA), await database.addToken(impostor, BY_ADA)]).toEqual([
        { kind: "done" },
        { kind: "done" },
        { kind: "id_taken" },
      ]);
      expect([await database.getToken(admin.id), await database.getToken(publisher.id), await database.getToken(BO)]).toEqual([admin, publisher, undefined]);
      expect(await database.listTokens()).toEqual([publisher, admin]);
      expect([await database.revokeToken(admin.id, BY_ADA), await database.revokeToken(admin.id, BY_ADA)]).toEqual([
        { kind: "done", token: admin },
        { kind: "not_found" },
      ]);
      expect([await database.listTokens(), await database.getToken(admin.id)]).toEqual([[publisher], undefined]);
      expect((await auditTrail(database)).map((entry) => [entry.action, entry.detail])).toEqual([
        ["token_added", { token: admin.id, scope: "admin", note: "laptop" }],
        ["token_added", { token: publisher.id, scope: "publisher", note: "" }],
        ["token_revoked", { token: admin.id, scope: "admin", note: "laptop" }],
      ]);
    });

    // Drift: a removed token keeps its row, which still holds its hash. A read that found that row again would let a removed token publish, and a new token could take its id and its name in the list.
    test("a removed token stays listed as ended with who removed it and when, never proves anything again, and keeps its id taken", async () => {
      const database = await opened(makeDatabase);
      const runsOut = (await mintToken({ scope: "admin", note: "laptop", now: NOW })).record;
      const [kept, removed] = [(await mintToken({ scope: "publisher", note: "ci", now: NOW + 1 })).record, (await mintToken({ scope: "publisher", note: "agent", now: NOW + 2 })).record];
      for (const token of [runsOut, kept, removed]) await database.addToken(token, BY_ADA);
      await database.revokeToken(removed.id, { by: ADMIN, at: NOW + 5 });
      const ranOutAt = runsOut.scope === "admin" ? runsOut.expiresAt : 0;
      const gone = { id: removed.id, scope: "publisher", note: "agent", createdAt: NOW + 2, endedAt: NOW + 5, how: "removed", by: ADMIN };
      const ranOut = { id: runsOut.id, scope: "admin", note: "laptop", createdAt: NOW, endedAt: ranOutAt, how: "ran_out" };

      expect<unknown>([
        await database.getToken(removed.id),
        await database.addToken({ ...kept, id: removed.id }, BY_ADA),
        await database.revokeToken(removed.id, BY_ADA),
        await database.listTokens(),
        await database.listTokenStates(ranOutAt - 1, 50),
        await database.listTokenStates(ranOutAt, 50),
        await database.listTokenStates(ranOutAt, 1),
      ]).toEqual([
        undefined,
        { kind: "id_taken" },
        { kind: "not_found" },
        [kept, runsOut],
        { live: [kept, runsOut], ended: [gone], more: false },
        { live: [kept], ended: [ranOut, gone], more: false },
        { live: [kept], ended: [ranOut], more: true },
      ]);
    });

    // Drift: a token that ran out can still be removed; the list must then name the removal once, not the token twice.
    test("a token removed after it ran out is listed once, as removed", async () => {
      const database = await opened(makeDatabase);
      const admin = (await mintToken({ scope: "admin", note: "laptop", now: NOW })).record;
      const ranOutAt = admin.scope === "admin" ? admin.expiresAt : 0;
      await database.addToken(admin, BY_ADA);
      await database.revokeToken(admin.id, { by: ADA, at: ranOutAt + 7 });
      const removed = { id: admin.id, scope: "admin", note: "laptop", createdAt: NOW, endedAt: ranOutAt + 7, how: "removed", by: ADA };

      expect<unknown>(await database.listTokenStates(ranOutAt + 9, 50)).toEqual({ live: [], ended: [removed], more: false });
    });

    // Drift: the sweep removes tokens by their end alone. One that went by a token's age would end the login of a computer that still publishes, and one that kept every ended token would let the table grow for ever.
    test("the sweep removes the tokens that ended over 90 days ago, by removal or by running out, and leaves a token that works, however old, and one that ended within 90 days", async () => {
      const database = await opened(makeDatabase);
      const longAgo = NOW - 1100 * DAY_MS;
      const minted = async (scope: "admin" | "publisher", note: string): Promise<TokenRecord> => (await mintToken({ scope, note, now: longAgo })).record;
      const [works, removedLong, ranOutLong] = [await minted("publisher", "works"), await minted("publisher", "removed long ago"), await minted("admin", "ran out long ago")];
      const [removedLately, removedOnTheDay] = [await minted("publisher", "removed lately"), await minted("publisher", "removed 90 days ago")];
      const all = [works, removedLong, ranOutLong, removedLately, removedOnTheDay];
      for (const token of all) await database.addToken(token, { by: ADMIN, at: longAgo });
      await database.revokeToken(removedLong.id, { by: ADMIN, at: NOW - 90 * DAY_MS - 1 });
      await database.revokeToken(removedLately.id, { by: ADMIN, at: NOW - DAY_MS });
      await database.revokeToken(removedOnTheDay.id, { by: ADMIN, at: NOW - 90 * DAY_MS });
      const told = async (): Promise<unknown> => {
        const { live, ended } = await database.listTokenStates(NOW, 50);

        return [live, ended.map((token) => token.note)];
      };

      const before = await told();
      await database.sweepRunOut(NOW);
      const rows = [...(await database.getTokenNames(all.map((token) => token.id))).values()].sort();

      // The list tells of the same ended tokens before the sweep as after it: one past its days is not told while it waits.
      expect<unknown>([await database.getToken(works.id), rows, before, await told()]).toEqual([
        works,
        ["removed 90 days ago", "removed lately", "works"],
        [[works], ["removed lately", "removed 90 days ago"]],
        [[works], ["removed lately", "removed 90 days ago"]],
      ]);
    });

    // Drift: the provider counts every row a sweep removes against the day's writes, so one run takes a bounded number; a run that took the newest ended first would leave the oldest for ever.
    test("one sweep removes no more than 25 ended tokens, the longest ended first, and the next one goes on", async () => {
      const database = await opened(makeDatabase);
      const longAgo = NOW - 200 * DAY_MS;
      const ended = await Promise.all(Array.from({ length: 27 }, async (_token, at) => (await mintToken({ scope: "publisher", note: `ci ${at}`, now: longAgo })).record));
      for (const [at, token] of ended.entries()) {
        await database.addToken(token, { by: ADMIN, at: longAgo });
        await database.revokeToken(token.id, { by: ADMIN, at: longAgo + 1 + at });
      }
      const left = async (): Promise<string[]> => [...(await database.getTokenNames(ended.map((token) => token.id))).values()].sort();

      await database.sweepRunOut(NOW);
      const afterOne = await left();
      await database.sweepRunOut(NOW);

      expect([afterOne, await left()]).toEqual([["ci 25", "ci 26"], []]);
    });

    // Drift: the token page shows this list; an order that changed between two reads would shuffle tokens made in the same millisecond.
    test("tokens made at the same moment list in descending order of id, after every newer one", async () => {
      const database = await opened(makeDatabase);
      const minted = await Promise.all(["a", "b", "c"].map((note) => mintToken({ scope: "publisher", note, now: NOW })));
      const newer = (await mintToken({ scope: "publisher", note: "d", now: NOW + 1 })).record;
      for (const token of [...minted.map((mint) => mint.record), newer]) await database.addToken(token, BY_ADA);
      const descending = minted.map((mint) => mint.record.id).sort((left, right) => (left < right ? 1 : -1));

      expect((await database.listTokens()).map((token) => token.id)).toEqual([newer.id, ...descending]);
    });

    // Drift: two admins each changing one setting must both be heard; a whole-record write would let the second silently undo the first.
    test("settings are stored once, and two changes of different keys at the same moment both land", async () => {
      const database = await opened(makeDatabase);

      expect([await database.readSettings(), await database.changeSettings({ trash_days: 30 }, BY_ADA)]).toEqual([undefined, { kind: "not_set_up" }]);
      expect(await database.initSettings(SETTINGS, BY_ADA)).toEqual({ kind: "done", values: SETTINGS });
      expect(await database.initSettings({ ...SETTINGS, trash_days: 99 }, BY_ADA)).toEqual({ kind: "already_set", values: SETTINGS });

      const size = { count: 5, unit: "GB" } as const;
      await Promise.all([
        database.changeSettings({ trash_days: 30, default_expires: { count: 7, unit: "d" } }, BY_ADA),
        database.changeSettings({ max_total_size: size, max_sites: 40 }, BY_ADA),
      ]);

      expect(await database.readSettings()).toEqual({
        ...SETTINGS,
        trash_days: 30,
        default_expires: { count: 7, unit: "d" },
        max_total_size: size,
        max_sites: 40,
      });
      expect(await database.changeSettings({ default_expires: "never", max_sites: "none" }, BY_ADA)).toEqual({
        kind: "done",
        values: { ...SETTINGS, trash_days: 30, max_total_size: size },
      });
      expect((await auditDetails(database, "settings_changed")).at(-1)).toEqual({ default_expires: "never", max_sites: "none" });
      await expect(database.changeSettings({ trash_days: 0 }, BY_ADA)).rejects.toThrow();
      await expect(database.changeSettings({ logins: [] }, BY_ADA)).rejects.toThrow();
    });

    // Drift: two admins changing people at the same moment must both be heard, and somebody must always be able to log in; a list read and written back would let the second undo the first, or let two removals empty it.
    test("one login is added or removed in one step: changes made at the same moment all land, and a login that works always stays", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy, di] = ["bo@example.com" as Login, "cy@example.com" as Login, "di@example.com" as Login];
      const byAdmin: Signed = { by: ADMIN, at: NOW + 1 };
      const kinds = (answers: readonly { readonly kind: string }[]): string[] => answers.map((answer) => answer.kind);
      const stored = async (): Promise<unknown> => [...((await database.readSettings())?.logins ?? [])].sort();

      expect(kinds(await Promise.all([database.addLogin(bo, BY_ADA), database.removeLogin(ADMIN, BY_ADA)]))).toEqual(["not_set_up", "not_set_up"]);
      await database.initSettings(SETTINGS, BY_ADA);
      const added = await Promise.all([database.addLogin(bo, BY_ADA), database.addLogin(cy, byAdmin), database.changeSettings({ trash_days: 30 }, BY_ADA)]);
      const crossed = await Promise.all([database.addLogin(di, byAdmin), database.removeLogin(bo, byAdmin)]);
      const values = { ...SETTINGS, trash_days: 30 };

      expect([kinds(added), kinds(crossed), await stored()]).toEqual([["done", "done", "done"], ["done", "done"], [ADMIN, cy, di]]);
      expect([
        await database.addLogin(cy, byAdmin),
        await database.removeLogin(bo, byAdmin),
        await database.removeLogin(ADMIN, byAdmin),
        await database.removeLogin(cy, BY_ADA),
        await database.removeLogin(di, BY_ADA),
        await database.removeLogin(ADMIN, BY_ADA),
      ]).toEqual([
        { kind: "unchanged", values: { ...values, logins: [ADMIN, cy, di] } },
        { kind: "unchanged", values: { ...values, logins: [ADMIN, cy, di] } },
        { kind: "no_working_login" },
        { kind: "done", values: { ...values, logins: [ADMIN, di] } },
        { kind: "done", values: { ...values, logins: [ADMIN] } },
        { kind: "no_working_login" },
      ]);

      const details = await auditDetails(database, "settings_changed");

      expect([details.length, details.slice(-2), await stored()]).toEqual([7, [{ logins: [ADMIN, di] }, { logins: [ADMIN] }], [ADMIN]]);
      await expect(database.addLogin("Bo@Example.com" as Login, BY_ADA)).rejects.toThrow();
      await expect(database.removeLogin("" as Login, BY_ADA)).rejects.toThrow();
    });

    // Drift: a token is its user's. A removal that left the user's tokens alive would keep that person in through every computer they allowed; one that ended a token of a user who stays would break a working agent.
    test("removing a user ends each token that user is behind, in the same step and each with its entry; a refused removal, a token that ran out, and the tokens of a user who stays are left as they were", async () => {
      const database = await opened(makeDatabase);
      const bo = "bo@example.com" as Login;
      await database.initSettings({ ...SETTINGS, logins: [ADMIN, bo] }, BY_ADA);
      const token = async (scope: "admin" | "publisher", note: string, now = NOW): Promise<TokenRecord> => (await mintToken({ scope, note, now })).record;
      const [stays, laptop, ci, old] = [await token("publisher", "stays"), await token("admin", "laptop", NOW + 1), await token("publisher", "ci", NOW + 2), await token("admin", "old", NOW - 31 * 86_400_000)];
      await database.addToken(stays, { by: ADMIN, at: NOW });
      for (const made of [laptop, old]) await database.addToken(made, { by: bo, at: NOW });
      // One made by a token is its maker's user's, and so is one that user allowed from a terminal.
      await database.addToken(ci, { by: laptop.id, at: NOW });
      const login = await pendingLogin();
      const agent = await token("publisher", "agent", NOW + 3);
      await database.addComputerLogin(login, ROOM);
      await database.decideComputerLogin(login.code, { state: "allowed", by: bo, at: NOW });
      await database.redeemComputerLogin(login.id, agent);
      // An approval the user gave and no terminal collected yet goes with the user too.
      const waiting = await pendingLogin();
      await database.addComputerLogin(waiting, ROOM);
      await database.decideComputerLogin(waiting.code, { state: "allowed", by: bo, at: NOW });
      const held = [...(await database.countUserTokens(NOW + 4))].sort();
      const working = async (): Promise<string[]> => (await database.listTokenStates(NOW + 9, 50)).live.map(({ note }) => note).sort();

      const refused = await database.removeLogin(ADMIN, { by: ADMIN, at: NOW + 4 });
      const untouched = await working();
      const removed = await database.removeLogin(bo, { by: ADMIN, at: NOW + 5 });
      const again = await database.removeLogin(bo, { by: ADMIN, at: NOW + 6 });
      // A request that was let in before the removal and stores its token after it stores none: the user behind the token that signs is gone, though one such token only ran out, and so is the user who allowed the waiting login.
      const late = [
        await database.addToken(await token("publisher", "late"), { by: laptop.id, at: NOW + 6 }),
        await database.addToken(await token("publisher", "late"), { by: old.id, at: NOW + 6 }),
        await database.redeemComputerLogin(waiting.id, await token("publisher", "late", NOW + 6)),
      ];
      await database.addLogin(bo, { by: ADMIN, at: NOW + 7 });
      const states = await database.listTokenStates(NOW + 9, 50);
      const went = (made: TokenRecord): unknown => ({ id: made.id, scope: made.scope, note: made.note, createdAt: made.createdAt, endedAt: NOW + 5, how: "user_removed", by: ADMIN });

      expect<unknown>([held, refused.kind, untouched, removed.kind, again.kind]).toEqual([
        [
          [ADMIN, 1],
          [bo, 3],
        ],
        "no_working_login",
        ["agent", "ci", "laptop", "stays"],
        "done",
        "unchanged",
      ]);
      expect<unknown>([states.live, [...states.ended].sort((left, right) => left.note.localeCompare(right.note)), [...(await database.countUserTokens(NOW + 9))]]).toEqual([
        [stays],
        [went(agent), went(ci), went(laptop), { id: old.id, scope: "admin", note: "old", createdAt: old.createdAt, endedAt: old.createdAt + 30 * 86_400_000, how: "ran_out" }],
        [[ADMIN, 1]],
      ]);
      expect(await Promise.all([laptop, ci, agent].map((made) => database.getToken(made.id)))).toEqual([undefined, undefined, undefined]);
      expect(late).toEqual([{ kind: "signer_gone" }, { kind: "signer_gone" }, { kind: "not_allowed" }]);
      expect(await auditDetails(database, "token_revoked")).toEqual([
        { token: laptop.id, scope: "admin", note: "laptop", user: bo },
        { token: ci.id, scope: "publisher", note: "ci", user: bo },
        { token: agent.id, scope: "publisher", note: "agent", user: bo },
      ]);
    });

    // Drift: a request is let in before its user is removed and may write after. A settings write that still landed would put the removed user back among the logins, or end the tokens of a user who stays.
    test("a change of the settings signed by a token whose user was removed since writes nothing, and one signed by a token that leaves its own user out lands whole, once", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy, di, ed] = ["bo@example.com" as Login, "cy@example.com" as Login, "di@example.com" as Login, "ed@example.com" as Login];
      await database.initSettings({ ...SETTINGS, logins: [ADMIN, bo, cy, di, ed] }, BY_ADA);
      await database.keepDomainCheck({ ran_at: NOW, by: ADA, run: "check", pieces: [] }, null);
      const token = async (note: string, now = NOW): Promise<TokenRecord> => (await mintToken({ scope: "admin", note, now })).record;
      // The token of cy runs out five milliseconds on: a removal after that leaves it as it ended.
      const [laptop, brief, pad, ci] = [await token("laptop"), await token("brief", NOW - 30 * DAY_MS + 5), await token("pad"), await token("ci")];
      for (const [made, by] of [[laptop, bo], [brief, cy], [pad, di], [ci, ed]] as const) await database.addToken(made, { by, at: NOW });
      const state = async (): Promise<unknown> => {
        const [stored, tokens, check] = [await database.readSettings(), await database.listTokenStates(NOW + 9, 50), await database.readDomainCheck()];
        const ended = Object.fromEntries(tokens.ended.map(({ note, how }) => [note, how]));

        return { logins: stored?.logins, outside: stored?.outside_pages, live: tokens.live.map(({ note }) => note).sort(), ended, changes: (await auditDetails(database, "settings_changed")).length, rulesWait: (check?.rules_changed_at ?? 0) > 0 };
      };
      await database.removeLogin(bo, { by: ADMIN, at: NOW + 1 });
      await database.removeLogin(cy, { by: ADMIN, at: NOW + 6 });
      const before = await state();
      const late: Signed = { by: laptop.id, at: NOW + 2 };
      // The token that ran out signs from before its end, as a request let in then would: its user is gone, so it is too.
      const ranOut: Signed = { by: brief.id, at: NOW + 2 };
      const refused = [
        await database.changeSettings({ logins: [ADMIN, bo], outside_pages: "allowed" }, late),
        await database.addLogin(bo, late),
        await database.removeLogin(cy, late),
        await database.removeLogin(di, late),
        await database.changeSettings({ logins: [ADMIN] }, ranOut),
        await database.removeLogin(cy, ranOut),
      ];
      const after = await state();
      const own = [await database.removeLogin(ed, { by: ci.id, at: NOW + 7 }), await database.changeSettings({ logins: [ADMIN], outside_pages: "allowed" }, { by: pad.id, at: NOW + 8 })];
      const again = await database.changeSettings({ logins: [ADMIN, di], outside_pages: "blocked" }, { by: pad.id, at: NOW + 8 });

      expect<unknown>([refused, after]).toEqual([Array.from({ length: 6 }, () => ({ kind: "signer_gone" })), before]);
      expect(before).toEqual({ logins: [ADMIN, di, ed], outside: "blocked", live: ["ci", "pad"], ended: { laptop: "user_removed", brief: "ran_out" }, changes: 2, rulesWait: false });
      expect<unknown>([own.map(({ kind }) => kind), again, await state()]).toEqual([
        ["done", "done"],
        { kind: "signer_gone" },
        { logins: [ADMIN], outside: "allowed", live: [], ended: { laptop: "user_removed", brief: "ran_out", pad: "user_removed", ci: "user_removed" }, changes: 4, rulesWait: true },
      ]);
    });

    // Drift: `poplin config logins` and an import replace the whole list. A list that dropped a user and kept that user's tokens would be the way round the removal.
    test("a list of logins that leaves users out ends their tokens with it, and a list that keeps everyone ends none", async () => {
      const database = await opened(makeDatabase);
      const [bo, cy] = ["bo@example.com" as Login, "cy@example.com" as Login];
      await database.initSettings({ ...SETTINGS, logins: [ADMIN, bo, cy] }, BY_ADA);
      const minted = await Promise.all(["ada", "bo", "cy"].map((note) => mintToken({ scope: "publisher", note, now: NOW })));
      const [ofAda, ofBo, ofCy] = minted.map((mint) => mint.record);
      if (ofAda === undefined || ofBo === undefined || ofCy === undefined) throw new Error("the tokens were not minted");

      await database.addToken(ofAda, { by: ADMIN, at: NOW });
      await database.addToken(ofBo, { by: bo, at: NOW });
      await database.addToken(ofCy, { by: cy, at: NOW });
      const live = async (): Promise<string[]> => (await database.listTokens()).map(({ note }) => note).sort();

      await database.changeSettings({ logins: [cy, bo, ADMIN], trash_days: 9 }, { by: ADMIN, at: NOW + 1 });
      const kept = await live();
      await database.changeSettings({ logins: [ADMIN, "di@example.com" as Login] }, { by: ADMIN, at: NOW + 2 });

      expect([kept, await live()]).toEqual([["ada", "bo", "cy"], ["ada"]]);
      expect((await database.listTokenStates(NOW + 3, 50)).ended.map(({ note, how, endedAt }) => [note, how, endedAt]).sort()).toEqual([
        ["bo", "user_removed", NOW + 2],
        ["cy", "user_removed", NOW + 2],
      ]);
      expect((await auditTrail(database)).slice(-3).map(({ action, by }) => [action, by])).toEqual([
        ["token_revoked", ADMIN],
        ["token_revoked", ADMIN],
        ["settings_changed", ADMIN],
      ]);
    });
  });
}

export function computerLogins(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the logins of computers`, () => {
    // Drift: the record `mintComputerLogin` makes is what a presented secret is checked against, and the code is what an admin is shown; a field lost on the way through a row would refuse every login.
    test("a pending login reads back as minted by its id and by its code, and a second one under its id or its code is refused", async () => {
      const database = await opened(makeDatabase);
      const login = await pendingLogin();
      const other = await pendingLogin();

      expect([
        await database.addComputerLogin(login, ROOM),
        await database.addComputerLogin({ ...other, id: login.id }, ROOM),
        await database.addComputerLogin({ ...other, code: login.code }, ROOM),
      ]).toEqual([{ kind: "done" }, { kind: "taken" }, { kind: "taken" }]);
      expect([await database.getComputerLogin(login.id), await database.findComputerLogin(login.code), await database.getComputerLogin(other.id), await database.findComputerLogin(other.code)]).toEqual([
        login,
        login,
        undefined,
        undefined,
      ]);
      expect(await auditTrail(database)).toEqual([]);
    });

    // Drift: anyone may ask for a login, so the room is the only bound on the table and on what one visitor holds of it. A bound that counted a decided or stale login, or took its place, would lock a visitor out or lose an allowed computer its token.
    test("a visitor keeps their newest waiting logins and all visitors together no more than the room, of callers at the same moment too, and a decided or stale login neither counts nor gives way", async () => {
      const database = await opened(makeDatabase);
      const room = { perVisitor: 2, all: 4 };
      const stored = async (logins: readonly PendingLogin[]): Promise<(string | undefined)[]> => Promise.all(logins.map(async (login) => (await database.getComputerLogin(login.id))?.state));
      const [stale, allowed, denied] = [await pendingLogin(NOW - 1), await pendingLogin(), await pendingLogin()];
      for (const login of [stale, allowed, denied]) await database.addComputerLogin(login, { perVisitor: 3, all: 4 });
      await database.decideComputerLogin(allowed.code, { state: "allowed", by: ADMIN, at: NOW });
      await database.decideComputerLogin(denied.code, { state: "denied", by: ADMIN, at: NOW });

      const own = [await pendingLogin(stale.expiresAt), await pendingLogin(stale.expiresAt + 1), await pendingLogin(stale.expiresAt + 2)];
      for (const login of own) await database.addComputerLogin(login, room);
      const afterOwn = await stored([stale, allowed, denied, ...own]);

      const others = await Promise.all(["two", "three", "four"].map((visitor) => pendingLogin(stale.expiresAt + 3, visitor)));
      const added = await Promise.all(others.map((login) => database.addComputerLogin(login, room)));

      expect(afterOwn).toEqual(["pending", "allowed", "denied", undefined, "pending", "pending"]);
      expect([added, await stored([stale, allowed, denied, ...own]), (await stored(others)).filter((state) => state === "pending").length]).toEqual([
        [{ kind: "done" }, { kind: "done" }, { kind: "done" }],
        ["pending", "allowed", "denied", undefined, undefined, "pending"],
        3,
      ]);
    });

    // Drift: the list is what an admin is shown to choose from; a decided or stale login in it would offer a button that does nothing, and a wrong order would bury the login just begun.
    test("the waiting logins are the pending ones that have not run out, the newest first", async () => {
      const database = await opened(makeDatabase);
      const [old, allowed, denied, stale, recent] = [await pendingLogin(NOW - 2), await pendingLogin(NOW - 1), await pendingLogin(NOW - 1), await pendingLogin(NOW - 10 * 60_000), await pendingLogin(NOW)];
      for (const login of [old, allowed, denied, stale, recent]) await database.addComputerLogin(login, ROOM);
      await database.decideComputerLogin(allowed.code, { state: "allowed", by: ADMIN, at: NOW });
      await database.decideComputerLogin(denied.code, { state: "denied", by: ADMIN, at: NOW });

      expect([await database.listWaitingComputerLogins(NOW), await database.listWaitingComputerLogins(old.expiresAt), await database.listWaitingComputerLogins(recent.expiresAt)]).toEqual([[recent, old], [recent], []]);
    });

    // Drift: a decision is what turns a request into a token; one that could be made twice, after the login ran out, or without its audit entry would let a denied or stale request through unseen.
    test("a pending login is decided once and before it runs out, with one audit entry that names the scope and the computer", async () => {
      const database = await opened(makeDatabase);
      const [allowed, denied, stale] = await Promise.all([pendingLogin(), pendingLogin(), pendingLogin()]);
      for (const login of [allowed, denied, stale]) await database.addComputerLogin(login, ROOM);
      const allow = { state: "allowed", by: ADMIN, at: NOW + 1 } as const;
      const deny = { state: "denied", by: ADMIN, at: NOW + 2 } as const;

      expect([
        await database.decideComputerLogin(allowed.code, allow),
        await database.decideComputerLogin(allowed.code, deny),
        await database.decideComputerLogin(denied.code, deny),
        await database.decideComputerLogin(denied.code, allow),
        await database.decideComputerLogin(stale.code, { ...allow, at: stale.expiresAt }),
        await database.decideComputerLogin((await pendingLogin()).code, allow),
      ]).toEqual([
        { kind: "done", login: { ...allowed, state: "allowed", decidedBy: ADMIN } },
        { kind: "not_pending" },
        { kind: "done", login: { ...denied, state: "denied", decidedBy: ADMIN } },
        { kind: "not_pending" },
        { kind: "not_pending" },
        { kind: "not_pending" },
      ]);
      expect((await auditTrail(database)).map((entry) => [entry.at, entry.by, entry.action, entry.detail])).toEqual([
        [NOW + 1, ADMIN, "login_allowed", { scope: "publisher", computer: "laptop" }],
        [NOW + 2, ADMIN, "login_denied", { scope: "publisher", computer: "laptop" }],
      ]);
      expect(await database.getComputerLogin(stale.id)).toEqual(stale);
    });

    // Drift: an admin may let a computer in for less than it asked. A lowered login that kept its scope would hand out an admin's token after the admin chose a publisher's, and the audit log would name the wrong one.
    test("a login allowed as a publisher is stored, audited, and redeemed as a publisher's, and a denied one keeps what it asked", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      const asks = async (): Promise<PendingLogin> => ({ ...(await pendingLogin()), scope: "admin" });
      const [lowered, kept, denied] = [await asks(), await asks(), await asks()];
      for (const login of [lowered, kept, denied]) await database.addComputerLogin(login, ROOM);
      const by = { by: ADMIN, at: NOW + 1 } as const;

      const decided = [
        await database.decideComputerLogin(lowered.code, { state: "allowed", asPublisher: true, ...by }),
        await database.decideComputerLogin(kept.code, { state: "allowed", asPublisher: false, ...by }),
        await database.decideComputerLogin(denied.code, { state: "denied", asPublisher: true, ...by }),
      ];
      const tokens = { admin: (await mintToken({ scope: "admin", note: "laptop", now: NOW + 2 })).record, publisher: (await mintToken({ scope: "publisher", note: "laptop", now: NOW + 2 })).record };

      expect(decided.map((answer) => (answer.kind === "done" ? [answer.login.scope, answer.login.state] : answer.kind))).toEqual([
        ["publisher", "allowed"],
        ["admin", "allowed"],
        ["admin", "denied"],
      ]);
      expect((await auditTrail(database)).map((entry) => [entry.action, entry.detail])).toEqual([
        ["settings_set", {}],
        ["login_allowed", { scope: "publisher", computer: "laptop" }],
        ["login_allowed", { scope: "admin", computer: "laptop" }],
        ["login_denied", { scope: "admin", computer: "laptop" }],
      ]);
      expect([await database.redeemComputerLogin(lowered.id, tokens.admin), await database.redeemComputerLogin(lowered.id, tokens.publisher)]).toEqual([{ kind: "not_allowed" }, { kind: "done" }]);
    });

    // Drift: two admins, or one who presses twice, decide at the same moment; both heard would leave a login allowed in the audit log and denied in its row.
    test("of an Allow and a Deny made at the same moment one is done, with its one audit entry", async () => {
      const database = await opened(makeDatabase);
      const login = await pendingLogin();
      await database.addComputerLogin(login, ROOM);

      const decided = await Promise.all((["allowed", "denied"] as const).map((state) => database.decideComputerLogin(login.code, { state, by: ADMIN, at: NOW + 1 })));
      const stored = await database.getComputerLogin(login.id);

      expect(decided.map((answer) => answer.kind).sort()).toEqual(["done", "not_pending"]);
      expect((await auditTrail(database)).map((entry) => entry.action)).toEqual([stored?.state === "allowed" ? "login_allowed" : "login_denied"]);
    });

    // Drift: the token is handed out once; a login that stayed after its token was stored, or two callers both served, would mint a second token nobody allowed.
    test("an allowed login gives one token, signed by who allowed it, and is gone; no other login gives any", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      const [allowed, pending, denied, stale] = await Promise.all([pendingLogin(), pendingLogin(), pendingLogin(), pendingLogin()]);
      for (const login of [allowed, pending, denied, stale]) await database.addComputerLogin(login, ROOM);
      for (const login of [allowed, stale]) await database.decideComputerLogin(login.code, { state: "allowed", by: ADMIN, at: NOW + 1 });
      await database.decideComputerLogin(denied.code, { state: "denied", by: ADMIN, at: NOW + 1 });
      const token = async (scope: "publisher" | "admin" = "publisher"): Promise<TokenRecord> => (await mintToken({ scope, note: "laptop", now: NOW + 2 })).record;

      expect([
        await database.redeemComputerLogin(pending.id, await token()),
        await database.redeemComputerLogin(denied.id, await token()),
        await database.redeemComputerLogin(stale.id, { ...(await token()), createdAt: stale.expiresAt }),
        await database.redeemComputerLogin(allowed.id, await token("admin")),
      ]).toEqual([{ kind: "not_allowed" }, { kind: "not_allowed" }, { kind: "not_allowed" }, { kind: "not_allowed" }]);

      const candidates = [await token(), await token()];
      const together = await Promise.all(candidates.map((candidate) => database.redeemComputerLogin(allowed.id, candidate)));
      const stored = await database.listTokens();
      const entries = (await auditTrail(database)).filter((entry) => entry.action === "token_added");

      expect(together.map((answer) => answer.kind).sort()).toEqual(["done", "not_allowed"]);
      expect(await database.redeemComputerLogin(allowed.id, await token())).toEqual({ kind: "not_allowed" });
      expect(await database.getComputerLogin(allowed.id)).toBeUndefined();
      expect(stored).toEqual(candidates.filter((_candidate, index) => together[index]?.kind === "done"));
      expect(entries.map((entry) => [entry.at, entry.by, entry.detail])).toEqual([[NOW + 2, ADMIN, { token: stored[0]?.id, scope: "publisher", note: "laptop" }]]);
    });

    // Drift: a login nobody decided or collected would stay for ever; a sweep that took a live one would end a login a person is in the middle of.
    test("the sweep removes every login that ran out, whatever its state, and leaves the others", async () => {
      const database = await opened(makeDatabase);
      const [old, decided, live] = await Promise.all([pendingLogin(), pendingLogin(), pendingLogin(NOW + 1)]);
      for (const login of [old, decided, live]) await database.addComputerLogin(login, ROOM);
      await database.decideComputerLogin(decided.code, { state: "allowed", by: ADMIN, at: NOW + 1 });

      expect([await database.sweepRunOut(old.expiresAt - 1), await database.sweepRunOut(old.expiresAt), await database.sweepRunOut(old.expiresAt)]).toEqual([0, 2, 0]);
      expect([await database.getComputerLogin(old.id), await database.getComputerLogin(decided.id), await database.getComputerLogin(live.id)]).toEqual([undefined, undefined, live]);
    });
  });
}

export function loginRoom(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: which waiting login gives way`, () => {
    // Drift: the order is (most held, oldest, smallest id). A store that compared times as text would keep 999 over 1000, and one that broke a tie by visitor would evict another login than the next store does.
    test("the oldest login of the visitor with the most gives way, by the number of its time and not its digits, and of two asked at one moment the one with the smaller id", async () => {
      const database = await opened(makeDatabase);
      const room = { perVisitor: 3, all: 4 };
      const asked = async (visitor: string, at: number, id: string): Promise<PendingLogin> => ({ ...(await pendingLogin(at, visitor)), id: id as LoginId });
      const [early, first, second, later] = [await asked("two", 998, "00000000000000d4"), await asked("one", 999, "00000000000000c3"), await asked("one", 1000, "00000000000000b2"), await asked("two", 1000, "00000000000000a1")];
      const waiting = async (): Promise<string[]> => {
        const stored = await Promise.all([early, first, second, later].map((login) => database.getComputerLogin(login.id)));

        return stored.flatMap((login) => (login === undefined ? [] : [`${login.visitor} at ${login.createdAt}`]));
      };
      const after: string[][] = [];

      for (const login of [early, first, second, later]) await database.addComputerLogin(login, room);
      for (const [at, visitor] of [
        [1001, "three"],
        [1002, "four"],
        [1003, "five"],
      ] as const) {
        await database.addComputerLogin(await pendingLogin(at, visitor), room);
        after.push(await waiting());
      }

      expect(after).toEqual([
        ["one at 999", "one at 1000", "two at 1000"],
        ["one at 1000", "two at 1000"],
        ["one at 1000"],
      ]);
    });
  });
}
