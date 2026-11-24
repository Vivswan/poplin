// The tokens of an install: issued, listed, and revoked by an admin, and a token's own to give back. A revoked token stays listed among the ended ones and works nowhere.
// A token is its user's: the tokens a user allowed end when that user is removed.

import * as v from "valibot";

import type { Actor } from "../../auth/scopes";
import { type EndedToken, mintToken, type TokenId, type TokenRecord } from "../../auth/tokens";
import { type Holder, MOMENT, TOKEN_ID } from "../../records/fields";
import { ADDRESS_LAYOUT } from "../../sites/address-layout";
import { readExpires } from "../sites/changes";
import { personOf, signedBy } from "./reach";
import { type Install, type Refused, refuse } from "../records";
import { UPDATE_NOTICE } from "../update/update";

/** The longest note a token carries, in characters. */
const MAX_NOTE_LENGTH = 200;

/** How many ended tokens a listing tells of: the ones that ended last, in the 90 days an ended token is kept. */
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

/** What a change of a token's expiry is asked with: `never`, or when the token is to run out, in a form `readExpires` takes. */
const TOKEN_EXPIRY = v.strictObject({ expires: v.string() });

/** What the API answers a token that asks who it is: the token, the version the install runs, how its site addresses are laid out, and a newer release when one is known. */
export const WHOAMI_ANSWER = v.object({ token: TOKEN_OBJECT, version: v.string(), layout: ADDRESS_LAYOUT, update: v.optional(UPDATE_NOTICE) });

/**
 * A token as a caller sees it: never the token itself, nor its hash. Times are milliseconds since the epoch.
 *
 * `expires` is `"never"` for a token that lives until it is revoked, whatever its scope.
 */
export type TokenObject = Readonly<v.InferOutput<typeof TOKEN_OBJECT>>;

/**
 * A token that ended as a caller sees it: when it was allowed, when it ended, and how. Times are milliseconds since the epoch.
 *
 * `by` is who removed it, or for `user_removed` who removed the user behind it; a token that ran out has none.
 */
type EndedTokenObject = { readonly id: TokenId; readonly scope: "publisher" | "admin"; readonly note: string; readonly created: number; readonly ended: number } & (
  | { readonly how: "removed" | "user_removed"; readonly by: Holder }
  | { readonly how: "ran_out" }
);

/** The object of a token that ended. */
function endedTokenObject(token: EndedToken): EndedTokenObject {
  const facts = { id: token.id, scope: token.scope, note: token.note, created: token.createdAt, ended: token.endedAt };

  return token.how === "ran_out" ? { ...facts, how: "ran_out" } : { ...facts, how: token.how, by: token.by };
}

/** Build the token object of a stored record. */
export function tokenObject(record: TokenRecord): TokenObject {
  return { id: record.id, scope: record.scope, note: record.note, created: record.createdAt, expires: record.expires };
}

/**
 * Issue a new token, which runs out as `defaultExpiry` has it for its scope.
 *
 * An admin may issue a publisher token. An admin token is issued only by a person, an actor whose holder is a login: a token that could issue admin tokens would outlive its own expiry.
 *
 * @param request - the scope and the note; anything is taken and checked
 * @returns the token, which is shown this once, and its record. `not_allowed` for a publisher, for a token asking for an admin token, for a token whose user was removed while it asked, and for a person removed while they asked
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

  if (asked.output.scope === "admin" && personOf(actor) === undefined) return refuse("not_allowed");

  const now = install.now();
  const minted = await mintToken({ ...asked.output, now });
  const added = await install.database.addToken(minted.record, signedBy(actor, now));
  if (added.kind === "signer_gone") return refuse("not_allowed");

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
 * List the tokens that work, the newest first, and apart from them the 50 that ended last in the past 90 days: the removed ones and the ones that ran out.
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
 * Count the tokens that work by the user behind each: what removing that user ends.
 *
 * @returns the count of every user behind a token, by the user's email, or `not_allowed` for anyone but an admin
 */
export async function countUserTokens(install: Install, actor: Actor): Promise<{ readonly ok: true; readonly counts: Readonly<Record<string, number>> } | Refused<"not_allowed">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  return { ok: true, counts: Object.fromEntries(await install.database.countUserTokens(install.now())) };
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

  const revoked = await install.database.revokeToken(id, signedBy(actor, install.now()));
  if (revoked.kind !== "done") return refuse("not_found");

  return { ok: true, token: tokenObject(revoked.token) };
}

/**
 * Set when a token that works runs out: later, sooner, or never. The change writes one audit entry, with the expiry before and after it; a token that already runs out then is left as it is.
 *
 * Only a person changes it, an actor whose holder is a login: a token that could move an expiry would outlive its own. A token that was revoked or ran out is ended for good.
 *
 * @param id - the token's id as sent, never the token itself
 * @param request - `expires`: `never`, or a moment that is still ahead; anything is taken and checked
 * @returns the token as it is now. `not_allowed` for anyone but an admin in a browser, and for one removed while they asked; `bad_argument` about `token` or `expires`; `not_found` for a token that does not work
 * @throws {Error} the database failed
 */
export async function changeTokenExpiry(
  install: Install,
  actor: Actor,
  id: string,
  request: v.InferInput<typeof TOKEN_EXPIRY>,
): Promise<{ readonly ok: true; readonly token: TokenObject } | Refused<"not_allowed" | "bad_argument" | "not_found">> {
  const person = personOf(actor);
  if (person === undefined) return refuse("not_allowed");

  if (!v.is(TOKEN_ID, id)) return refuse("bad_argument", "token");

  const now = install.now();
  const asked = v.safeParse(TOKEN_EXPIRY, request);
  const expires = asked.success ? readExpires(asked.output.expires, now) : undefined;
  if (expires === undefined) return refuse("bad_argument", "expires");

  const changed = await install.database.changeTokenExpiry(id, expires, { as: "person", by: person, at: now });
  if (changed.kind === "done") return { ok: true, token: tokenObject(changed.token) };

  return refuse(changed.kind === "signer_gone" ? "not_allowed" : "not_found");
}
