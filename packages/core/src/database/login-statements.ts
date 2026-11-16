// The statements that read tokens and the logins of computers, the ones that make room for a new login, and the one that removes the tokens that ended long ago.

import { and, asc, count, eq, gt, inArray, isNull, lt, or, type SQL, sql as fragment } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import type { PendingLogin } from "../auth/computer-logins";
import type { TokenId } from "../auth/tokens";
import { HISTORY_KEPT_MS } from "../records/audit";
import { TOKEN_ID } from "../records/fields";
import type { Signed } from "./database";
import type { Statement } from "./driver";
import { audit, logins, settings, tokens } from "./schema";
import { BUILD, built, CHANGED, insertFrom } from "./statements";

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

/**
 * The user behind a new token: the signer who allows it, or the user behind the token that signs.
 *
 * @param by - who signs the token's making, as a value or a column
 */
export function userBehind(by: SQL | string): SQL {
  return fragment`coalesce((SELECT ${SIGNER.allowed_by} FROM ${tokens} AS ${SIGNER} WHERE ${SIGNER.id} = ${by}), ${by})`;
}

/** Whether a column holds one of the stored logins: a user who is one still. */
export function isUser(column: SQL): SQL {
  return fragment`EXISTS (SELECT 1 FROM ${settings}, json_each(${settings.value}, '$.logins') AS j WHERE ${settings.id} = 1 AND j.value = ${column})`;
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

/** The tokens that work at a moment, counted by the user behind them. */
export function userTokenCounts(now: number): Statement {
  return built(BUILD.select({ allowed_by: tokens.allowed_by, held: count().as("held") }).from(tokens).where(worksAt(now)).groupBy(tokens.allowed_by));
}

/**
 * End every token that works and whose user leaves, each with a `token_revoked` audit entry that names the user. A token that ran out stays as it ended.
 *
 * @param leaves - true of a token row whose user is no login once the batch is through
 * @param after - `change` for a batch where the entries follow the one audit entry of the change that makes the user leave: nothing is written where that entry was not
 * @returns the entries, then the marks: two statements that read the same rows
 */
function endTokensWhere(leaves: SQL, signed: Signed, after?: "change"): readonly [Statement, Statement] {
  const ends = and(worksAt(signed.at), leaves);
  const named = fragment`json_object('token', ${tokens.id}, 'scope', ${tokens.scope}, 'note', ${tokens.note}, 'user', ${tokens.allowed_by})`;
  // The entries follow one entry written, and the marks follow the entries: as many as the tokens that end.
  const [entered, marked] = after === undefined ? [ends, ends] : [and(ends, CHANGED), and(ends, fragment`changes() > 0`)];
  const entries = fragment`SELECT ${signed.at}, ${signed.by}, 'token_revoked', ${named} FROM ${tokens} WHERE ${entered} ORDER BY ${tokens.created_at}, ${tokens.id}`;

  return [
    insertFrom(audit, [audit.at, audit.actor, audit.action, audit.detail], entries),
    built(BUILD.update(tokens).set({ removed_at: signed.at, removed_by: signed.by, user_removed: 1 }).where(marked)),
  ];
}

/** End the tokens of one user: it goes right after the audit entry of that user's removal in a batch, and does nothing where the removal was refused. */
export function endTokensOfRemoved(login: string, signed: Signed): readonly [Statement, Statement] {
  return endTokensWhere(fragment`${tokens.allowed_by} = ${login}`, signed, "change");
}

/**
 * End the tokens of every user a new list of logins leaves out, for a signer who stands: it goes before the list replaces the stored logins in a batch, since it reads who was a login.
 * The token that signs is left to `endSignerLeftOut`, so it stands for every statement up to the replacement.
 */
export function endTokensOfDropped(next: readonly string[], signed: Signed): readonly [Statement, Statement] {
  const dropped = fragment`(SELECT was.value FROM ${settings}, json_each(${settings.value}, '$.logins') AS was WHERE ${settings.id} = 1 AND was.value NOT IN (SELECT value FROM json_each(${JSON.stringify(next)})))`;

  return endTokensWhere(fragment`${tokens.allowed_by} IN ${dropped} AND ${tokens.id} <> ${signed.by} AND ${signerStands(signed)}`, signed);
}

/** End the token that signs a list of logins which leaves its own user out: it goes right after the audit entry of the list's change in a batch, and does nothing where the list was refused. */
export function endSignerLeftOut(signed: Signed): readonly [Statement, Statement] {
  return endTokensWhere(fragment`${tokens.id} = ${signed.by} AND NOT ${isUser(fragment`${tokens.allowed_by}`)}`, signed, "change");
}

/** The token with the given id, unless it was removed. */
export function tokenById(id: TokenId): Statement {
  return built(BUILD.select(TOKEN_FIELDS).from(tokens).where(and(eq(tokens.id, id), NOT_REMOVED)));
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
