// Bearer tokens for agents and the CLI: minting one, the hashed record kept of it, and checking a presented one.

import type { Scope } from "./scopes";

const TOKEN_PREFIX = "poplin_";
const ID_BYTES = 8;
const SECRET_BYTES = 32;
const TOKEN_PATTERN = new RegExp(`^${TOKEN_PREFIX}([0-9a-f]{${ID_BYTES * 2}})_[0-9a-f]{${SECRET_BYTES * 2}}$`);
const ADMIN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const ENCODER = new TextEncoder();

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

/** What a new token is for. `note` is stored as given, such as a workspace's name. */
export type MintRequest = { readonly scope: Scope; readonly note: string; readonly now: number };

/** A new token and its record. `token` exists only here: show it once and store the record. */
export type Minted = { readonly token: string; readonly record: TokenRecord };

function refuse(refusal: TokenRefusal): { readonly ok: false; readonly refusal: TokenRefusal } {
  return { ok: false, refusal };
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomHex(byteCount: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(byteCount)));
}

async function sha256Hex(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest(HMAC.hash, ENCODER.encode(text))));
}

async function sameText(left: string, right: string): Promise<boolean> {
  // The platform compares the two MACs in constant time; the key lives for this one comparison.
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(SECRET_BYTES)), HMAC, false, ["sign", "verify"]);
  const mac = await crypto.subtle.sign(HMAC.name, key, ENCODER.encode(left));

  return crypto.subtle.verify(HMAC.name, key, mac, ENCODER.encode(right));
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
 * @returns `false` for every publisher token, which lives until its record is deleted
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
