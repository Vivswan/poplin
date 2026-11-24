// The one place a row of the tokens table becomes the token record `mintToken` makes, or what is told of a token that ended.

import * as v from "valibot";

import type { EndedToken, TokenRecord } from "../auth/tokens";
import { HOLDER, MOMENT, TOKEN_ID } from "./fields";

/** The form of a token's hash: a SHA-256 in lowercase hex. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** A token's scope, which says nothing of when the token runs out. */
const SCOPE = v.picklist(["admin", "publisher"]);

/** A row of the tokens table. `expires_at` is NULL for a token that never runs out. */
const TOKEN_ROW = v.strictObject({ id: TOKEN_ID, hash: v.pipe(v.string(), v.regex(HASH_PATTERN)), scope: SCOPE, note: v.string(), created_at: MOMENT, expires_at: v.nullable(MOMENT) });

/** What a row of an ended token holds however it ended: no hash. */
const ENDED_ALWAYS = { id: TOKEN_ID, scope: SCOPE, note: v.string(), created_at: MOMENT };

/** A row of a token that ended: one that was removed names when and by whom, and whether it went with its user; one that only ran out holds the moment it did. */
const ENDED_ROW = v.union([
  v.strictObject({ ...ENDED_ALWAYS, expires_at: v.nullable(MOMENT), removed_at: MOMENT, removed_by: HOLDER, user_removed: v.picklist([0, 1]) }),
  v.strictObject({ ...ENDED_ALWAYS, expires_at: MOMENT, removed_at: v.null(), removed_by: v.null(), user_removed: v.literal(0) }),
]);

/**
 * Turn a row of a token that ended into what is told of it.
 *
 * @param row - the row without its hash
 * @throws {Error} the row is of no ended token
 */
export function endedTokenFromRow(row: unknown): EndedToken {
  const parsed = v.safeParse(ENDED_ROW, row);
  if (!parsed.success) throw new Error(`a stored token is not an ended token: ${v.summarize(parsed.issues)}`);

  const { id, scope, note, created_at: createdAt } = parsed.output;
  if (parsed.output.removed_at === null) return { id, scope, note, createdAt, endedAt: parsed.output.expires_at, how: "ran_out" };

  const how = parsed.output.user_removed === 1 ? "user_removed" : "removed";

  return { id, scope, note, createdAt, endedAt: parsed.output.removed_at, how, by: parsed.output.removed_by };
}

/**
 * Turn a row of the tokens table into a token record.
 *
 * @param row - the row without the marks of its end
 * @returns the record in the fields of `TokenRecord`, which stays their one definition
 * @throws {Error} the row is no token record
 */
export function tokenFromRow(row: unknown): TokenRecord {
  const parsed = v.safeParse(TOKEN_ROW, row);
  if (!parsed.success) throw new Error(`a stored token is not a token: ${v.summarize(parsed.issues)}`);

  const { id, hash, scope, note, created_at: createdAt, expires_at: expiresAt } = parsed.output;

  return { id, hash, note, createdAt, scope, expires: expiresAt ?? "never" };
}
