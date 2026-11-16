// Bearer tokens for agents and the CLI: minting one, the hashed record kept of it, and checking a presented one.

import type { Holder } from "../records/fields";
import type { Scope } from "./scopes";
import { randomHex, sameText, sha256Hex } from "./util";

const TOKEN_PREFIX = "poplin_";
const ID_BYTES = 8;
const SECRET_BYTES = 32;
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}([0-9a-f]{${ID_BYTES * 2}})_[0-9a-f]{${SECRET_BYTES * 2}}$`);
const ADMIN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

declare const tokenIdBrand: unique symbol;

/** The public half of a token: it names the stored record and proves nothing. */
export type TokenId = string & { readonly [tokenIdBrand]: true };

/** Why a presented token was refused. `mismatch` means it is well formed but is not this record's token. */
type TokenRefusal = "malformed" | "mismatch" | "expired";

/** A checked value, or the reason the token was refused. */
export type CheckedToken<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly refusal: TokenRefusal };

/** What is stored of a token. `hash` is the SHA-256 of the whole token in hex; times are milliseconds since the epoch. */
export type TokenRecord = { readonly id: TokenId; readonly hash: string; readonly note: string; readonly createdAt: number } & (
  | { readonly scope: "admin"; readonly expiresAt: number }
  | { readonly scope: "publisher" }
);

/**
 * What is told of a token that ended: never its hash. `endedAt` is when it was removed, or when it ran out.
 *
 * A token removed after it ran out counts as removed, at its removal. `user_removed` is a token that ended because the user behind it was removed, and `by` is who removed that user.
 */
export type EndedToken = { readonly id: TokenId; readonly note: string; readonly createdAt: number; readonly endedAt: number } & (
  | { readonly how: "removed" | "user_removed"; readonly scope: Scope; readonly by: Holder }
  | { readonly how: "ran_out"; readonly scope: "admin" }
);

/** What a new token is for. `note` is stored as given, such as a workspace's name. */
export type MintRequest = { readonly scope: Scope; readonly note: string; readonly now: number };

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
 * Decide whether a record's token has run out.
 *
 * @param now - the clock, in milliseconds since the epoch; a clock that is not a number counts as run out
 * @returns `false` for every publisher token, which lives until it is removed
 */
export function isExpired(record: TokenRecord, now: number): boolean {
  if (record.scope === "publisher") return false;

  return !(now < record.expiresAt);
}

/**
 * Make a new token: `poplin_`, a 64-bit id, and 256 random bits from Web Crypto, all in lowercase hex.
 *
 * @returns the token and its record; an admin record expires 30 days after `now`
 */
export async function mintToken(request: MintRequest): Promise<Minted> {
  const id = randomHex(ID_BYTES) as TokenId;
  const token = `${TOKEN_PREFIX}${id}_${randomHex(SECRET_BYTES)}`;
  const facts = { id, hash: await sha256Hex(token), note: request.note, createdAt: request.now };

  if (request.scope === "publisher") return { token, record: { ...facts, scope: "publisher" } };

  return { token, record: { ...facts, scope: "admin", expiresAt: request.now + ADMIN_LIFETIME_MS } };
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
