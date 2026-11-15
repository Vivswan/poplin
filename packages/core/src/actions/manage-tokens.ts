// The tokens of an install: issued, listed, and revoked by an admin, and a token's own to give back. A revoked token stays listed among the ended ones and works nowhere.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { type EndedToken, mintToken, type TokenId, type TokenRecord } from "../auth/tokens";
import { type Holder, MOMENT, TOKEN_ID } from "../records/fields";
import { type Install, type Refused, refuse } from "./records";
import { UPDATE_NOTICE } from "./update";

/** The longest note a token carries, in characters. */
const MAX_NOTE_LENGTH = 200;

/** How many ended tokens a listing tells of: the ones that ended last. */
const MOST_ENDED = 50;

/** What a new token is asked with: its scope, and a note that says what it is for, such as a workspace's name. */
export const TOKEN_REQUEST = v.strictObject({ scope: v.picklist(["publisher", "admin"]), note: v.pipe(v.string(), v.maxLength(MAX_NOTE_LENGTH)) });

/** A token as an answer holds it. */
export const TOKEN_OBJECT = v.object({
  id: TOKEN_ID,
  scope: v.picklist(["publisher", "admin"]),
  note: v.string(),
  created: MOMENT,
  expires: v.union([v.literal("never"), MOMENT]),
});

/** What revoking a token answers, and so a logout: the token as it was. */
export const REVOKED_TOKEN = v.object({ token: TOKEN_OBJECT });

/** What the API answers a token that asks who it is: the token, the version the install runs, the word its public addresses end in, and a newer release when one is known. */
export const WHOAMI_ANSWER = v.object({ token: TOKEN_OBJECT, version: v.string(), public_word: v.string(), update: v.optional(UPDATE_NOTICE) });

/**
 * A token as a caller sees it: never the token itself, nor its hash. Times are milliseconds since the epoch.
 *
 * `expires` is `"never"` for a publisher token, which lives until it is revoked.
 */
export type TokenObject = Readonly<v.InferOutput<typeof TOKEN_OBJECT>>;

/**
 * A token that ended as a caller sees it: when it was allowed, when it ended, and how. Times are milliseconds since the epoch.
 *
 * `by` is who removed it; a token that ran out has none.
 */
type EndedTokenObject = { readonly id: TokenId; readonly note: string; readonly created: number; readonly ended: number } & (
  | { readonly how: "removed"; readonly scope: "publisher" | "admin"; readonly by: Holder }
  | { readonly how: "ran_out"; readonly scope: "admin" }
);

/** The object of a token that ended. */
function endedTokenObject(token: EndedToken): EndedTokenObject {
  const facts = { id: token.id, note: token.note, created: token.createdAt, ended: token.endedAt };

  return token.how === "removed" ? { ...facts, how: "removed", scope: token.scope, by: token.by } : { ...facts, how: "ran_out", scope: "admin" };
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
 * List every token that was not removed, the newest first. One that ran out is among them, with its expiry.
 *
 * @returns the tokens, or `not_allowed` for anyone but an admin
 */
export async function listTokens(install: Install, actor: Actor): Promise<{ readonly ok: true; readonly tokens: readonly TokenObject[] } | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  return { ok: true, tokens: (await install.database.listTokens()).map(tokenObject) };
}

/**
 * Name the tokens among some holders: what a screen writes where a token published or changed something. A removed token and one that ran out keep their names.
 *
 * @param holders - whoever a page names; an email is no token and is skipped
 * @returns the note of each token that has one, by the token's id, or `not_allowed` for anyone but an admin
 */
export async function nameTokens(
  install: Install,
  actor: Actor,
  holders: readonly string[],
): Promise<{ readonly ok: true; readonly names: Readonly<Record<string, string>> } | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const ids = holders.filter((holder) => v.is(TOKEN_ID, holder));

  return { ok: true, names: Object.fromEntries(await install.database.getTokenNames(ids)) };
}

/**
 * List the tokens that work, the newest first, and apart from them the 50 that ended last: the removed ones and the ones that ran out.
 *
 * @returns `more` says that more than 50 ended. `not_allowed` for anyone but an admin
 */
export async function listTokenStates(
  install: Install,
  actor: Actor,
): Promise<{ readonly ok: true; readonly tokens: readonly TokenObject[]; readonly ended: readonly EndedTokenObject[]; readonly more: boolean } | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const { live, ended, more } = await install.database.listTokenStates(install.now(), MOST_ENDED);

  return { ok: true, tokens: live.map(tokenObject), ended: ended.map(endedTokenObject), more };
}

/**
 * Revoke a token, so it proves nothing from then on. It stays listed among the ended ones.
 *
 * @param id - the token's id as sent, never the token itself
 * @returns the token as it was. An admin revokes any token; every actor revokes its own. `not_allowed` for a publisher naming another token
 */
export async function revokeToken(
  install: Install,
  actor: Actor,
  id: string,
): Promise<({ readonly ok: true } & Readonly<v.InferOutput<typeof REVOKED_TOKEN>>) | Refused<"not_allowed" | "bad_argument" | "not_found">> {
  if (!v.is(TOKEN_ID, id)) return refuse("bad_argument", "token");

  if (actor.scope !== "admin" && actor.holder !== id) return refuse("not_allowed");

  const revoked = await install.database.revokeToken(id, { by: actor.holder, at: install.now() });
  if (revoked.kind !== "done") return refuse("not_found");

  return { ok: true, token: tokenObject(revoked.token) };
}
