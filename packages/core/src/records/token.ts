// The one place a row of the tokens table becomes the token record `mintToken` makes, or what is told of a token that ended.

import * as v from "valibot";

import type { EndedToken, TokenRecord } from "../auth/tokens";
import { HOLDER, MOMENT, TOKEN_ID } from "./fields";

/** The form of a token's hash: a SHA-256 in lowercase hex. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** What a row holds whatever the token's scope. */
const ALWAYS = { id: TOKEN_ID, hash: v.pipe(v.string(), v.regex(HASH_PATTERN)), note: v.string(), created_at: MOMENT };

/** A row of the tokens table. Only an admin token has an expiry. */
const TOKEN_ROW = v.variant("scope", [
  v.strictObject({ ...ALWAYS, scope: v.literal("admin"), expires_at: MOMENT }),
  v.strictObject({ ...ALWAYS, scope: v.literal("publisher"), expires_at: v.null() }),
]);

/** What a row of an ended token holds however it ended: no hash. */
const ENDED_ALWAYS = { id: TOKEN_ID, note: v.string(), created_at: MOMENT };

/** A row of a token that ended: one that was removed names when and by whom, and one that only ran out is an admin's. */
const ENDED_ROW = v.union([
  v.strictObject({ ...ENDED_ALWAYS, scope: v.picklist(["admin", "publisher"]), expires_at: v.nullable(MOMENT), removed_at: MOMENT, removed_by: HOLDER }),
  v.strictObject({ ...ENDED_ALWAYS, scope: v.literal("admin"), expires_at: MOMENT, removed_at: v.null(), removed_by: v.null() }),
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

  const { id, note, created_at: createdAt } = parsed.output;
  if (parsed.output.removed_at === null) return { id, note, createdAt, endedAt: parsed.output.expires_at, how: "ran_out", scope: parsed.output.scope };

  return { id, note, createdAt, endedAt: parsed.output.removed_at, how: "removed", scope: parsed.output.scope, by: parsed.output.removed_by };
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

  const { id, hash, note, created_at: createdAt } = parsed.output;
  if (parsed.output.scope === "publisher") return { id, hash, note, createdAt, scope: "publisher" };

  return { id, hash, note, createdAt, scope: "admin", expiresAt: parsed.output.expires_at };
}
