// The one place a row of the tokens table becomes the token record `mintToken` makes.

import * as v from "valibot";

import type { TokenRecord } from "../auth/tokens";
import { MOMENT, TOKEN_ID } from "./fields";

/** The form of a token's hash: a SHA-256 in lowercase hex. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** What a row holds whatever the token's scope. */
const ALWAYS = { id: TOKEN_ID, hash: v.pipe(v.string(), v.regex(HASH_PATTERN)), note: v.string(), created_at: MOMENT };

/** A row of the tokens table. Only an admin token has an expiry. */
const TOKEN_ROW = v.variant("scope", [
  v.strictObject({ ...ALWAYS, scope: v.literal("admin"), expires_at: MOMENT }),
  v.strictObject({ ...ALWAYS, scope: v.literal("publisher"), expires_at: v.null() }),
]);

/**
 * Turn a row of the tokens table into a token record.
 *
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
