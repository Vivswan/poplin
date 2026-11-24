// Bearer tokens for agents and the CLI: minting one, the hashed record kept of it, and checking a presented one.

import type { Holder } from "../records/fields";
import type { Scope } from "./scopes";
import { randomHex, sameText, sha256Hex } from "./util";

const TOKEN_PREFIX = "poplin_";
const ID_BYTES = 8;
const SECRET_BYTES = 32;
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}([0-9a-f]{${ID_BYTES * 2}})_[0-9a-f]{${SECRET_BYTES * 2}}$`);
const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days a token of each scope lasts when nobody chose: an admin token 30, and a publisher token until it is revoked. */
const DEFAULT_LIFETIME_DAYS = { admin: 30, publisher: "never" } as const satisfies Readonly<Record<Scope, number | "never">>;

declare const tokenIdBrand: unique symbol;

/** The public half of a token: it names the stored record and proves nothing. */
export type TokenId = string & { readonly [tokenIdBrand]: true };

/** Why a presented token was refused. `mismatch` means it is well formed but is not this record's token. */
type TokenRefusal = "malformed" | "mismatch" | "expired";

/** A checked value, or the reason the token was refused. */
export type CheckedToken<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly refusal: TokenRefusal };

/** When a token runs out: a moment in milliseconds since the epoch, or `"never"` for one that lives until it is revoked. The scope of a token says nothing of it. */
export type TokenExpiry = "never" | number;

/** What is stored of a token. `hash` is the SHA-256 of the whole token in hex; times are milliseconds since the epoch. */
export interface TokenRecord {
  readonly id: TokenId;
  readonly hash: string;
  readonly note: string;
  readonly createdAt: number;
  readonly scope: Scope;
  readonly expires: TokenExpiry;
}

/**
 * What is told of a token that ended: never its hash. `endedAt` is when it was removed, or when it ran out.
 *
 * A token removed after it ran out counts as removed, at its removal. `user_removed` is a token that ended because the user behind it was removed, and `by` is who removed that user.
 */
export type EndedToken = { readonly id: TokenId; readonly scope: Scope; readonly note: string; readonly createdAt: number; readonly endedAt: number } & (
  | { readonly how: "removed" | "user_removed"; readonly by: Holder }
  | { readonly how: "ran_out" }
);

/** What a new token is for. `note` is stored as given, such as a workspace's name. `expires` is when it runs out; left out, it lasts as long as a token of its scope does when nobody chose. */
export type MintRequest = { readonly scope: Scope; readonly note: string; readonly now: number; readonly expires?: TokenExpiry };

/** A new token and its record. `token` exists only here: show it once and store the record. */
export type Minted = { readonly token: string; readonly record: TokenRecord };

function refuse(refusal: TokenRefusal): { readonly ok: false; readonly refusal: TokenRefusal } {
  return { ok: false, refusal };
}

/**
 * Read the id out of a presented token, to find its record.
 *
 * @returns the id, or `malformed` for any string that is not shaped like a token; never throws
 */
export function parseToken(presented: string): CheckedToken<TokenId> {
  const id = TOKEN_PATTERN.exec(presented)?.[1];
  if (id === undefined) return refuse("malformed");

  return { ok: true, value: id as TokenId };
}

/**
 * Decide whether a record's token has run out, whatever its scope.
 *
 * @param now - the clock, in milliseconds since the epoch; a clock that is not a number counts as run out
 * @returns `false` for a token that never expires, which lives until it is removed
 */
export function isExpired(record: Pick<TokenRecord, "expires">, now: number): boolean {
  if (record.expires === "never") return false;

  return !(now < record.expires);
}

/**
 * When a token of a scope runs out if nobody chooses: an admin token 30 days after `now`, a publisher token never.
 *
 * @param now - the moment the days are counted from, in milliseconds since the epoch
 */
export function defaultExpiry(scope: Scope, now: number): TokenExpiry {
  const days = DEFAULT_LIFETIME_DAYS[scope];

  return days === "never" ? "never" : now + days * DAY_MS;
}

/**
 * Make a new token: `poplin_`, a 64-bit id, and 256 random bits from Web Crypto, all in lowercase hex.
 *
 * @returns the token and its record, which runs out when the request says, or as `defaultExpiry` has it for its scope
 */
export async function mintToken(request: MintRequest): Promise<Minted> {
  const id = randomHex(ID_BYTES) as TokenId;
  const token = `${TOKEN_PREFIX}${id}_${randomHex(SECRET_BYTES)}`;
  const expires = request.expires ?? defaultExpiry(request.scope, request.now);

  return { token, record: { id, hash: await sha256Hex(token), note: request.note, createdAt: request.now, scope: request.scope, expires } };
}

/**
 * Decide whether a presented token is the live token of a record.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns the record, or the first reason for refusal; the hashes are compared in constant time and nothing throws
 */
export async function verifyToken(presented: string, record: TokenRecord, now: number): Promise<CheckedToken<TokenRecord>> {
  const id = parseToken(presented);
  if (!id.ok) return id;

  const matches = await sameText(record.hash, await sha256Hex(presented));
  if (!matches) return refuse("mismatch");

  if (isExpired(record, now)) return refuse("expired");

  return { ok: true, value: record };
}
