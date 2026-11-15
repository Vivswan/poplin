// The part of the database contract about who may come in: tokens and settings, the logins of computers, and the signing key.

import { describe, expect, test } from "bun:test";

import type { LoginId, PendingLogin } from "../../../src/auth/computer-logins";
import type { Login } from "../../../src/auth/logins";
import { mintToken, type TokenRecord } from "../../../src/auth/tokens";
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

export function signingKey(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: the signing key`, () => {
    // Drift: two Workers that each kept their own key would refuse each other's cookies, signing people out at random.
    test("starters at the same moment end with one key, a later starter gets it, and replacing it is the only thing that changes it", async () => {
      const database = await opened(makeDatabase);
      const none = await database.readSigningKey();
      const started = await Promise.all([FIRST_KEY, SECOND_KEY, THIRD_KEY].map((fresh) => database.ensureSigningKey(fresh, NOW)));
      const winner = started.find((start) => start.kind === "created")?.key;
      const later = await database.ensureSigningKey(new Uint8Array(32).fill(0xd4), NOW + 1);
      await database.rotateSigningKey(new Uint8Array(48).fill(0xe5), { by: BO, at: NOW + 2 });

      expect(none).toBeUndefined();
      expect(started.map((start) => start.kind).sort()).toEqual(["created", "kept", "kept"]);
      expect<unknown>(started.map((start) => start.key)).toEqual([winner, winner, winner]);
      expect<unknown>([FIRST_KEY, SECOND_KEY, THIRD_KEY]).toContainEqual(winner);
      expect<unknown>(later).toEqual({ kind: "kept", key: winner });
      expect<unknown>(await database.readSigningKey()).toEqual(new Uint8Array(48).fill(0xe5));
      expect(await auditTrail(database)).toEqual([{ seq: 1, at: NOW + 2, by: BO, action: "signed_everyone_out", site: null, detail: {} }]);
      await expect(database.ensureSigningKey(new Uint8Array(31), NOW)).rejects.toThrow(RangeError);
      await expect(database.rotateSigningKey(new Uint8Array(31), BY_ADA)).rejects.toThrow(RangeError);
      expect<unknown>(await database.readSigningKey()).toEqual(new Uint8Array(48).fill(0xe5));
    });

    // Drift: a backup or a dashboard page that carried the key would let whoever reads it sign a cookie for any login.
    test("no listing, export, settings read, or audit entry holds the key, before or after it is replaced", async () => {
      const database = await opened(makeDatabase);
      await database.initSettings(SETTINGS, BY_ADA);
      await database.addToken((await mintToken({ scope: "admin", note: "laptop", now: NOW })).record, BY_ADA);
      const site = await made(database, draft(REPORT, "public", DOCS));
      await database.trashSite((await made(database, draft(REPORT))).id, BY_ADA);
      await database.ensureSigningKey(FIRST_KEY, NOW);
      await database.rotateSigningKey(SECOND_KEY, BY_ADA);

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
      const needles = ["a1".repeat(32), "b2".repeat(32), "161,161", "178,178", '"161"', '"178"'];

      expect(needles.filter((needle) => shown.includes(needle))).toEqual([]);
      expect(shown).toContain("signed_everyone_out");
      expect<unknown>(await database.readSigningKey()).toEqual(SECOND_KEY);
    });
  });
}

export function tokensAndSettings(label: string, makeDatabase: DatabaseFactory): void {
  describe(`${label}: tokens and settings`, () => {
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

      expect([await database.sweepComputerLogins(old.expiresAt - 1), await database.sweepComputerLogins(old.expiresAt), await database.sweepComputerLogins(old.expiresAt)]).toEqual([0, 2, 0]);
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
