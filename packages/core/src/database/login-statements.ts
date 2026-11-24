// The statements that read tokens and the logins of computers, the ones that make room for a new login, the one that removes the tokens that ended long ago, and what a change of the settings is written and read back with.

import { and, asc, count, eq, gt, inArray, isNull, lt, or, type SQL, sql as fragment } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import type { LoginId, PendingLogin, UserCode } from "../auth/computer-logins";
import type { TokenExpiry, TokenId, TokenRecord } from "../auth/tokens";
import { HISTORY_KEPT_MS } from "../records/audit";
import { TOKEN_ID } from "../records/fields";
import type { SettingValues } from "../records/settings";
import type { LoginDecision, Signed, SignedByPerson } from "./database";
import type { Statement, StatementResult } from "./driver";
import { audit, logins, settings, tokens } from "./schema";
import { BUILD, built, CHANGED, insertFrom, PLAIN_AUDIT_COLUMNS } from "./statements";

/** The columns a token is written with. */
export const TOKEN_COLUMNS = [tokens.id, tokens.hash, tokens.scope, tokens.note, tokens.created_at, tokens.expires_at, tokens.allowed_by];

/** What is read of a token that can still prove something: the columns it was written with. */
export const TOKEN_FIELDS = { id: tokens.id, hash: tokens.hash, scope: tokens.scope, note: tokens.note, created_at: tokens.created_at, expires_at: tokens.expires_at };

/** What is read of a token that ended: never its hash. */
export const ENDED_TOKEN_FIELDS = { id: tokens.id, scope: tokens.scope, note: tokens.note, created_at: tokens.created_at, expires_at: tokens.expires_at, removed_at: tokens.removed_at, removed_by: tokens.removed_by, user_removed: tokens.user_removed };

/** The id and the note of a token, as `getTokenNames` reads them. */
export const NAMED_TOKEN = v.object({ id: TOKEN_ID, note: v.string() });

/** The tokens table as `signer`: the token that signs the making of another. */
const SIGNER = alias(tokens, "signer");

/** True of a token that was not removed. Every read of a token that may prove something holds it. */
export const NOT_REMOVED = isNull(tokens.removed_at);

/** The most tokens one trim removes. The sweep trims up to 96 times a day, and the provider counts a token removed as up to three rows written. */
const MOST_TOKENS_TRIMMED = 25;

/** How many tokens that work a user is behind, as `countUserTokens` reads them. */
export const USER_TOKENS = v.object({ allowed_by: v.string(), held: v.pipe(v.number(), v.integer(), v.minValue(1)) });

/** True of a token that works at a moment: not removed, and not run out. */
export function worksAt(now: number): SQL | undefined {
  return and(NOT_REMOVED, or(isNull(tokens.expires_at), gt(tokens.expires_at, now)));
}

/** A token's expiry as its column holds it: `NULL` for a token that never runs out. */
export function storedExpiry(expires: TokenExpiry): number | null {
  return expires === "never" ? null : expires;
}

/**
 * The user behind a new token: the signer who allows it, or the user behind the token that signs.
 *
 * @param by - who signs the token's making, as a value or a column
 */
export function userBehind(by: SQL | string): SQL {
  return fragment`coalesce((SELECT ${SIGNER.allowed_by} FROM ${tokens} AS ${SIGNER} WHERE ${SIGNER.id} = ${by}), ${by})`;
}

/** Whether a column holds one of the stored users: a user who is one still. */
function isUser(column: SQL): SQL {
  return fragment`EXISTS (SELECT 1 FROM ${settings}, json_each(${settings.value}, '$.users') AS j WHERE ${settings.id} = 1 AND j.value = ${column})`;
}

/** Whether a token that signs may still write: it was not removed, and the user behind it is a user still, whether or not the token has run out since it was let in. */
function tokenStands(id: TokenId): SQL {
  const gone = fragment`${SIGNER.removed_at} IS NOT NULL OR NOT ${isUser(fragment`${SIGNER.allowed_by}`)}`;

  return fragment`NOT EXISTS (SELECT 1 FROM ${tokens} AS ${SIGNER} WHERE ${SIGNER.id} = ${id} AND (${gone}))`;
}

/**
 * Whether who signs may still write, for the statement that writes: a token as `tokenStands` has it, and a person while their email is a stored login.
 * The first login, the sweeper, and a repair hold nothing that can be taken away, so they always stand.
 */
export function signerStands(signed: Signed): SQL {
  switch (signed.as) {
    case "token":
      return tokenStands(signed.by);
    case "person":
      return isUser(fragment`${signed.by}`);
    case "first_login":
    case "sweeper":
    case "repair":
      return fragment`1`;
  }
}

/** Whether an email is one of the stored users, for a statement on the settings row. */
export function isStoredLogin(email: string): SQL {
  return fragment`EXISTS (SELECT 1 FROM json_each(${settings.value}, '$.users') AS j WHERE j.value = ${email})`;
}

/** The settings, and whether who signs a change of them still stands. */
export function settingsAndSigner(signed: Signed): Statement {
  return built(BUILD.select({ value: settings.value, stands: fragment<number>`${signerStands(signed)}`.as("stands") }).from(settings).where(eq(settings.id, 1)));
}

/** Whether the settings a change comes to keep `auto_update` on only beside `update_check`. It reads the stored settings by itself, so a statement on any table can wait on it. */
function updatePairKept(patched: SQL): SQL {
  const alone = fragment`json_extract(${patched}, '$.auto_update') = 1 AND json_extract(${patched}, '$.update_check') = 0`;

  return fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1 AND NOT (${alone}))`;
}

/** Whether each user the alerts go to, in the settings a change comes to, is one of the users there. It reads the stored settings by itself, as `updatePairKept` does. */
function alertUsersFit(patched: SQL): SQL {
  const stranger = fragment`EXISTS (SELECT 1 FROM json_each(${patched}, '$.alert_users') AS chosen WHERE chosen.value NOT IN (SELECT value FROM json_each(${patched}, '$.users')))`;

  return fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1 AND NOT ${stranger})`;
}

/** The settings a change of the users comes to, with the users the alerts go to kept among them: one who is no user any more leaves that list in the same write, in the list's order. */
export function alertUsersKept(changed: SQL<string>): SQL<string> {
  const kept = fragment`(SELECT json_group_array(chosen.value) FROM json_each(${changed}, '$.alert_users') AS chosen WHERE chosen.value IN (SELECT value FROM json_each(${changed}, '$.users')))`;

  return fragment<string>`json_set(${changed}, '$.alert_users', json(${kept}))`;
}

/**
 * The settings a change comes to, and what must hold of them for any statement of the change to write.
 * New users with no word of who the alerts go to keep that list among themselves.
 * Only a change of an update setting can part the two, and only one that names who the alerts go to can name somebody who is no user.
 *
 * @returns the settings as JSON, a merge patch that replaces each key the change names and leaves every other; and the condition, `undefined` for a change that can break neither pair
 */
export function settingsPatched(changes: Partial<SettingValues>): { readonly patched: SQL<string>; readonly fits: SQL | undefined } {
  const merged = fragment<string>`json_patch(${settings.value}, ${JSON.stringify(changes)})`;
  const patched = changes.users !== undefined && changes.alert_users === undefined ? alertUsersKept(merged) : merged;
  const pair = changes.update_check === undefined && changes.auto_update === undefined ? undefined : updatePairKept(patched);

  return { patched, fits: and(pair, changes.alert_users === undefined ? undefined : alertUsersFit(patched)) };
}

/** Whether the read of `settingsAndSigner` found a signer who no longer stands. */
export function signerGone(read: StatementResult | undefined): boolean {
  return read?.rows[0]?.stands !== 1;
}

/** The users of one list that another does not hold, as a JSON array. Each list is a `json_each` of an array, which the engine walks in the array's order. */
function usersApart(held: SQL, missing: SQL): SQL {
  return fragment`(SELECT json_group_array(one.value) FROM ${held} AS one WHERE one.value NOT IN (SELECT value FROM ${missing}))`;
}

/**
 * The audit entry of a change of the settings, with the values it sets. New users are held with who they add and who they leave out, as `added` and `removed`.
 * It goes before the change in a batch, under the change's own condition: it reads the users still stored.
 */
export function auditOfSettings(signed: Signed, changes: Partial<SettingValues>, lands: SQL | undefined): Statement {
  const [stored, given] = [fragment`json_each(${settings.value}, '$.users')`, fragment`json_each(${JSON.stringify(changes.users ?? [])})`];
  const users = fragment`json_set(${JSON.stringify(changes)}, '$.added', json(${usersApart(given, stored)}), '$.removed', json(${usersApart(stored, given)}))`;
  const detail = changes.users === undefined ? fragment`${JSON.stringify(changes)}` : users;

  return insertFrom(audit, PLAIN_AUDIT_COLUMNS, fragment`SELECT ${signed.at}, ${signed.by}, 'settings_changed', ${detail} FROM ${settings} WHERE ${lands}`);
}

/** The tokens that work at a moment, counted by the user behind them. */
export function userTokenCounts(now: number): Statement {
  return built(BUILD.select({ allowed_by: tokens.allowed_by, held: count().as("held") }).from(tokens).where(worksAt(now)).groupBy(tokens.allowed_by));
}

/**
 * End every token that works and whose user leaves, each with a `token_revoked` audit entry that names the user. A token that ran out stays as it ended.
 *
 * @param leaves - true of a token row whose user is no login once the batch is through
 * @param after - `change` for a batch where the entries follow the one statement that says the user leaves, the change itself or its audit entry: nothing is written where that wrote nothing
 * @returns the entries, then the marks: two statements that read the same rows
 */
function endTokensWhere(leaves: SQL, signed: Signed, after?: "change"): readonly [Statement, Statement] {
  const ends = and(worksAt(signed.at), leaves);
  const named = fragment`json_object('token', ${tokens.id}, 'scope', ${tokens.scope}, 'note', ${tokens.note}, 'user', ${tokens.allowed_by})`;
  // The entries follow one row written, and the marks follow the entries: as many as the tokens that end.
  const [entered, marked] = after === undefined ? [ends, ends] : [and(ends, CHANGED), and(ends, fragment`changes() > 0`)];
  const entries = fragment`SELECT ${signed.at}, ${signed.by}, 'token_revoked', ${named} FROM ${tokens} WHERE ${entered} ORDER BY ${tokens.created_at}, ${tokens.id}`;

  return [
    insertFrom(audit, PLAIN_AUDIT_COLUMNS, entries),
    built(BUILD.update(tokens).set({ removed_at: signed.at, removed_by: signed.by, user_removed: 1 }).where(marked)),
  ];
}

/** End the tokens of one user: it goes right after the audit entry of that user's removal in a batch, and does nothing where the removal was refused. */
export function endTokensOfRemoved(login: string, signed: Signed): readonly [Statement, Statement] {
  return endTokensWhere(fragment`${tokens.allowed_by} = ${login}`, signed, "change");
}

/**
 * End the tokens of every user a new list of users leaves out, for a signer who stands: it goes before the list replaces the stored users in a batch, since it reads who was a user.
 * The token that signs is left to `endSignerLeftOut`, so it stands for every statement up to the replacement.
 *
 * @param when - what else must hold for the list to be written; left out, nothing else
 */
export function endTokensOfDropped(next: readonly string[], signed: Signed, when: SQL = fragment`1`): readonly [Statement, Statement] {
  const dropped = fragment`(SELECT was.value FROM ${settings}, json_each(${settings.value}, '$.users') AS was WHERE ${settings.id} = 1 AND was.value NOT IN (SELECT value FROM json_each(${JSON.stringify(next)})))`;

  return endTokensWhere(fragment`${tokens.allowed_by} IN ${dropped} AND ${tokens.id} <> ${signed.by} AND ${signerStands(signed)} AND ${when}`, signed);
}

/** End the token that signs a list of users which leaves its own user out: it goes right after the list's change in a batch, and does nothing where the list was refused. */
export function endSignerLeftOut(signed: Signed): readonly [Statement, Statement] {
  return endTokensWhere(fragment`${tokens.id} = ${signed.by} AND NOT ${isUser(fragment`${tokens.allowed_by}`)}`, signed, "change");
}

/** The token with the given id, unless it was removed. */
export function tokenById(id: TokenId): Statement {
  return built(BUILD.select(TOKEN_FIELDS).from(tokens).where(and(eq(tokens.id, id), NOT_REMOVED)));
}

/** The token with the given id, if it works at a moment. */
export function workingToken(id: TokenId, at: number): Statement {
  return built(BUILD.select(TOKEN_FIELDS).from(tokens).where(and(eq(tokens.id, id), worksAt(at))));
}

/**
 * Set when a token that works at `signed.at` runs out, for a signer who stands: the audit entry of the change, with the expiry before and after it, then the change, made only where the entry was written.
 * A token that already runs out then gets neither.
 */
export function tokenExpiryChanged(id: TokenId, expires: TokenExpiry, signed: SignedByPerson): readonly [Statement, Statement] {
  const to = storedExpiry(expires);
  const detail = fragment`json_object('token', ${tokens.id}, 'scope', ${tokens.scope}, 'note', ${tokens.note}, 'from', ${tokens.expires_at}, 'to', ${to})`;
  const changes = and(eq(tokens.id, id), worksAt(signed.at), fragment`${tokens.expires_at} IS NOT ${to}`, signerStands(signed));
  const entry = fragment`SELECT ${signed.at}, ${signed.by}, 'token_expiry_changed', ${detail} FROM ${tokens} WHERE ${changes}`;

  return [insertFrom(audit, PLAIN_AUDIT_COLUMNS, entry), built(BUILD.update(tokens).set({ expires_at: to }).where(and(eq(tokens.id, id), CHANGED)))];
}

/** What a decision writes into its login: how it was decided and by whom. An allowed login also keeps when its token runs out, and becomes a publisher's when its decider asks so. */
function decidedColumns(decision: LoginDecision): Partial<typeof logins.$inferInsert> {
  const decided = { state: decision.state, decided_by: decision.by };
  if (decision.state === "denied") return decided;

  const allowed = { ...decided, token_expires_at: storedExpiry(decision.tokenExpires) };

  return decision.asPublisher === true ? { ...allowed, scope: "publisher" } : allowed;
}

/**
 * Decide the login under a code, only while it is pending and has not run out: the decision, then its audit entry, written only where the decision was. The entry names the scope and the computer, and nothing of the secret.
 * An allowed login becomes a publisher's when its decider asks so, and keeps when its token runs out.
 */
export function loginDecided(code: UserCode, decision: LoginDecision): readonly [Statement, Statement] {
  const waits = and(eq(logins.code, code), eq(logins.state, "pending"), gt(logins.expires_at, decision.at));
  const action = decision.state === "allowed" ? "login_allowed" : "login_denied";
  const entry = fragment`SELECT ${decision.at}, ${decision.by}, ${action}, json_object('scope', ${logins.scope}, 'computer', ${logins.computer}) FROM ${logins} WHERE ${logins.code} = ${code} AND ${CHANGED}`;

  return [built(BUILD.update(logins).set(decidedColumns(decision)).where(waits)), insertFrom(audit, PLAIN_AUDIT_COLUMNS, entry)];
}

/**
 * Turn an allowed login into its token: the token's record, its `token_added` audit entry, and the removal of the login, each made only where the one before it was.
 * A token is stored only while the login is allowed, has not run out, is of the token's scope, keeps the token's expiry, and whoever allowed it is a user still.
 */
export function loginRedeemed(id: LoginId, token: TokenRecord): readonly [Statement, Statement, Statement] {
  const expires = storedExpiry(token.expires);
  const detail = JSON.stringify({ token: token.id, scope: token.scope, note: token.note });
  const decided = fragment`${logins.state} = 'allowed' AND ${isUser(fragment`${logins.decided_by}`)}`;
  // A token that would be made at or after its own expiry is not made: the terminal is answered as for a login that ran out, and keeps the login it has.
  const ahead = fragment`(${logins.token_expires_at} IS NULL OR ${logins.token_expires_at} > ${token.createdAt})`;
  const fits = fragment`${logins.scope} = ${token.scope} AND ${logins.token_expires_at} IS ${expires} AND ${ahead}`;
  const allowed = fragment`${logins.id} = ${id} AND ${decided} AND ${logins.expires_at} > ${token.createdAt} AND ${fits}`;
  const idIsFree = fragment`NOT EXISTS (SELECT 1 FROM ${tokens} WHERE ${tokens.id} = ${token.id})`;
  const stored = fragment`SELECT ${token.id}, ${token.hash}, ${logins.scope}, ${token.note}, ${token.createdAt}, ${logins.token_expires_at}, ${logins.decided_by} FROM ${logins} WHERE ${allowed} AND ${idIsFree}`;
  // The entry is signed by whoever allowed the login, and the login goes only when the entry was written.
  const entry = fragment`SELECT ${token.createdAt}, ${logins.decided_by}, 'token_added', ${detail} FROM ${logins} WHERE ${logins.id} = ${id} AND ${CHANGED}`;

  return [insertFrom(tokens, TOKEN_COLUMNS, stored), insertFrom(audit, PLAIN_AUDIT_COLUMNS, entry), built(BUILD.delete(logins).where(and(eq(logins.id, id), CHANGED)))];
}

/** The id and the note of each of these tokens that has a note, removed or not: a name proves nothing. The ids are the only values bound to the statement, and a database binds only so many. */
export function tokenNames(ids: readonly TokenId[]): Statement {
  return built(BUILD.select({ id: tokens.id, note: tokens.note }).from(tokens).where(and(inArray(tokens.id, ids), fragment`${tokens.note} <> ''`)));
}

/**
 * Build the statement that removes the tokens that ended over 90 days before a moment, the longest ended first, no more than `MOST_TOKENS_TRIMMED` of them.
 *
 * Only a token's end decides: `end_at` is its removal, else its expiry, and is `NULL` for a token that never ends. A token that works at the moment has no end before it, however long ago it was made.
 */
export function endedTokensTrimmed(now: number): Statement {
  const longEnded = BUILD.select({ id: tokens.id }).from(tokens).where(lt(tokens.end_at, now - HISTORY_KEPT_MS)).orderBy(asc(tokens.end_at)).limit(MOST_TOKENS_TRIMMED);

  return built(BUILD.delete(tokens).where(inArray(tokens.id, longEnded)));
}

/** The logins a condition holds for. */
export function loginsWhere(condition: SQL | undefined): Statement {
  return built(BUILD.select().from(logins).where(condition));
}

/** Whether a login's id and its code are both free, so the login that brings them will be stored. */
export function isNewLogin(login: PendingLogin): SQL {
  return fragment`NOT EXISTS (SELECT 1 FROM ${logins} WHERE ${logins.id} = ${login.id} OR ${logins.code} = ${login.code})`;
}

/** Room for a new login of its visitor: of that visitor's logins that wait, pending and not run out, all but the newest `keep` are removed. */
export function makeRoomOfVisitor(login: PendingLogin, keep: number): Statement {
  const waiting = fragment`${logins.visitor} = ${login.visitor} AND ${logins.state} = 'pending' AND ${logins.expires_at} > ${login.createdAt}`;
  const beyond = fragment`(SELECT ${logins.id} FROM ${logins} WHERE ${waiting} ORDER BY ${logins.created_at} DESC, ${logins.id} DESC LIMIT -1 OFFSET ${keep})`;

  return built(BUILD.delete(logins).where(fragment`${logins.id} IN ${beyond} AND ${isNewLogin(login)}`));
}

/**
 * Room for a new login among all: once `all` logins wait, the oldest one of the visitor with the most is removed.
 * One pass finds it: each visitor's oldest is its `created_at` in sixteen digits then its id, and `9999 - held` in four digits puts the visitor with the most first.
 */
export function makeRoomOfAll(login: PendingLogin, all: number): Statement {
  const oldest = fragment`MIN(printf('%016d', ${logins.created_at}) || ${logins.id})`;
  const byVisitor = fragment`SELECT COUNT(*) AS held, ${oldest} AS oldest FROM ${logins} WHERE ${logins.state} = 'pending' AND ${logins.expires_at} > ${login.createdAt} GROUP BY ${logins.visitor}`;
  const evicted = fragment`(SELECT CASE WHEN SUM(held) >= ${all} THEN substr(MIN(printf('%04d', 9999 - held) || oldest), 21) END FROM (${byVisitor}))`;

  return built(BUILD.delete(logins).where(fragment`${logins.id} = ${evicted} AND ${isNewLogin(login)}`));
}
