// The tokens of an install: issued, listed, and revoked by an admin, and a token's own to give back.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { mintToken, type TokenId, type TokenRecord } from "../auth/tokens";
import { TOKEN_ID } from "../records/fields";
import { type Install, type Refused, refuse } from "./records";

/** The longest note a token carries, in characters. */
const MAX_NOTE_LENGTH = 200;

/** What a new token is asked with: its scope, and a note that says what it is for, such as a workspace's name. */
export const TOKEN_REQUEST = v.strictObject({ scope: v.picklist(["publisher", "admin"]), note: v.pipe(v.string(), v.maxLength(MAX_NOTE_LENGTH)) });

/**
 * A token as a caller sees it: never the token itself, nor its hash. Times are milliseconds since the epoch.
 *
 * `expires` is `"never"` for a publisher token, which lives until it is revoked.
 */
export interface TokenObject {
  readonly id: TokenId;
  readonly scope: TokenRecord["scope"];
  readonly note: string;
  readonly created: number;
  readonly expires: "never" | number;
}

/** Build the token object of a stored record. */
export function tokenObject(record: TokenRecord): TokenObject {
  const expires = record.scope === "admin" ? record.expiresAt : "never";

  return { id: record.id, scope: record.scope, note: record.note, created: record.createdAt, expires };
}

/**
 * Issue a new token.
 *
 * An admin may issue a publisher token. An admin token is issued only by a person, an actor whose holder is a login: a token that could issue admin tokens would outlive its own expiry.
 *
 * @param request - the scope and the note; anything is taken and checked
 * @returns the token, which is shown this once, and its record. `not_allowed` for a publisher, and for a token asking for an admin token
 * @throws {Error} the database failed
 */
export async function issueToken(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof TOKEN_REQUEST>,
): Promise<{ readonly ok: true; readonly token: string; readonly record: TokenObject } | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(TOKEN_REQUEST, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  if (asked.output.scope === "admin" && v.is(TOKEN_ID, actor.holder)) return refuse("not_allowed");

  const now = install.now();
  const minted = await mintToken({ ...asked.output, now });
  const added = await install.database.addToken(minted.record, { by: actor.holder, at: now });
  if (added.kind !== "done") throw new Error("a new token drew an id that is taken");

  return { ok: true, token: minted.token, record: tokenObject(minted.record) };
}

/**
 * List every token, the newest first.
 *
 * @returns the tokens, or `not_allowed` for anyone but an admin
 */
export async function listTokens(install: Install, actor: Actor): Promise<{ readonly ok: true; readonly tokens: readonly TokenObject[] } | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  return { ok: true, tokens: (await install.database.listTokens()).map(tokenObject) };
}

/**
 * Revoke a token, so it proves nothing from then on.
 *
 * @param id - the token's id as sent, never the token itself
 * @returns the token as it was. An admin revokes any token; every actor revokes its own. `not_allowed` for a publisher naming another token
 */
export async function revokeToken(
  install: Install,
  actor: Actor,
  id: string,
): Promise<{ readonly ok: true; readonly token: TokenObject } | Refused<"not_allowed" | "bad_argument" | "not_found">> {
  if (!v.is(TOKEN_ID, id)) return refuse("bad_argument", "token");

  if (actor.scope !== "admin" && actor.holder !== id) return refuse("not_allowed");

  const revoked = await install.database.revokeToken(id, { by: actor.holder, at: install.now() });
  if (revoked.kind !== "done") return refuse("not_found");

  return { ok: true, token: tokenObject(revoked.token) };
}
