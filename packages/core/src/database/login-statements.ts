// The statements that read tokens and the logins of computers, the ones that make room for a new login, and the one that removes the tokens that ended long ago.

import { and, asc, eq, inArray, isNull, lt, type SQL, sql as fragment } from "drizzle-orm";
import * as v from "valibot";

import type { PendingLogin } from "../auth/computer-logins";
import type { TokenId } from "../auth/tokens";
import { HISTORY_KEPT_MS } from "../records/audit";
import { TOKEN_ID } from "../records/fields";
import type { Statement } from "./driver";
import { logins, tokens } from "./schema";
import { BUILD, built } from "./statements";

/** The columns a token is written with. */
export const TOKEN_COLUMNS = [tokens.id, tokens.hash, tokens.scope, tokens.note, tokens.created_at, tokens.expires_at];

/** What is read of a token that can still prove something: the columns it was written with. */
export const TOKEN_FIELDS = { id: tokens.id, hash: tokens.hash, scope: tokens.scope, note: tokens.note, created_at: tokens.created_at, expires_at: tokens.expires_at };

/** What is read of a token that ended: never its hash. */
export const ENDED_TOKEN_FIELDS = { id: tokens.id, scope: tokens.scope, note: tokens.note, created_at: tokens.created_at, expires_at: tokens.expires_at, removed_at: tokens.removed_at, removed_by: tokens.removed_by };

/** The id and the note of a token, as `getTokenNames` reads them. */
export const NAMED_TOKEN = v.object({ id: TOKEN_ID, note: v.string() });

/** True of a token that was not removed. Every read of a token that may prove something holds it. */
export const NOT_REMOVED = isNull(tokens.removed_at);

/** The most tokens one trim removes. The sweep trims up to 96 times a day, and the provider counts a token removed as up to three rows written. */
const MOST_TOKENS_TRIMMED = 25;

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
