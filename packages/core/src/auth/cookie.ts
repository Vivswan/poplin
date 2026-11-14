// The owner's session value: an email and an issue time under one HMAC-SHA-256 signature, as a cookie-safe string.
//
//   <base64url email> . <issue time, ms> . <base64url signature of everything before the last dot>

import { type Login, parseLogin } from "./logins";

const MAX_VALUE_LENGTH = 1024;
const VALUE_PATTERN = /^([A-Za-z0-9_-]+\.(0|[1-9][0-9]{0,15}))\.([A-Za-z0-9_-]{43})$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder("utf-8", { ignoreBOM: true });

/** Why a session value was refused. `bad-signature` covers a changed value and a value signed under another key. */
type SessionRefusal = "malformed" | "bad-signature" | "expired";

/** The email a session value names, or the reason the value was refused. */
export type CheckedSession = { readonly ok: true; readonly value: Login } | { readonly ok: false; readonly refusal: SessionRefusal };

/** What a session value is built from. `issuedAt` is whole milliseconds since the epoch; `key` comes from `importSessionKey`. */
export type SessionFacts = { readonly email: Login; readonly issuedAt: number; readonly key: CryptoKey };

/** What a session value is checked against. `now` is milliseconds since the epoch, and `maxAgeMs` the oldest a live value may be, in milliseconds. */
export type SessionCheck = { readonly key: CryptoKey; readonly now: number; readonly maxAgeMs: number };

type SessionParts = { readonly signed: string; readonly issuedAt: number; readonly signature: Uint8Array<ArrayBuffer> };

function refuse(refusal: SessionRefusal): { readonly ok: false; readonly refusal: SessionRefusal } {
  return { ok: false, refusal };
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  // A length of 4n+1 is the one shape `atob` throws on once the alphabet is right.
  if (!BASE64URL_PATTERN.test(text) || text.length % 4 === 1) return undefined;

  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

  // Several spellings decode to the same bytes; only the one the encoder writes is accepted.
  if (toBase64Url(bytes) !== text) return undefined;

  return bytes;
}

function splitValue(value: string): SessionParts | undefined {
  if (value.length > MAX_VALUE_LENGTH) return undefined;

  const [, signed, issued, encodedSignature] = VALUE_PATTERN.exec(value) ?? [];
  if (signed === undefined || issued === undefined || encodedSignature === undefined) return undefined;

  const issuedAt = Number(issued);
  const signature = fromBase64Url(encodedSignature);

  if (!Number.isSafeInteger(issuedAt) || signature === undefined) return undefined;

  return { signed, issuedAt, signature };
}

function signedEmail(signed: string): Login | undefined {
  const bytes = fromBase64Url(signed.slice(0, signed.indexOf(".")));
  if (bytes === undefined) return undefined;

  const email = DECODER.decode(bytes);
  const login = parseLogin(email);

  // Only the normal form is ever signed. The decoder keeps a byte-order mark, so a marked email fails here too.
  if (!login.ok || login.value !== email) return undefined;

  return login.value;
}

/**
 * Turn secret bytes into the key that signs and verifies session values.
 *
 * @param secret - at least 32 random bytes; rotating them ends every session
 * @returns an HMAC-SHA-256 key that cannot be exported; rejects on an empty secret
 */
export function importSessionKey(secret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", secret, HMAC, false, ["sign", "verify"]);
}

/**
 * Build the session value for an email.
 *
 * @returns a string of letters, digits, `-`, `_`, and `.`; safe as a cookie value and in a URL
 */
export async function buildSession(facts: SessionFacts): Promise<string> {
  const signed = `${toBase64Url(ENCODER.encode(facts.email))}.${facts.issuedAt}`;
  const signature = await crypto.subtle.sign(HMAC.name, facts.key, ENCODER.encode(signed));

  return `${signed}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Decide whether a string is a live session value.
 *
 * @param value - untrusted text; nothing in it is read before the signature holds
 * @returns the email, or the first reason for refusal; never throws. A value issued after `now` is live, so clocks may disagree a little
 */
export async function verifySession(value: string, check: SessionCheck): Promise<CheckedSession> {
  const parts = splitValue(value);
  if (parts === undefined) return refuse("malformed");

  const genuine = await crypto.subtle.verify(HMAC.name, check.key, parts.signature, ENCODER.encode(parts.signed));
  if (!genuine) return refuse("bad-signature");

  const email = signedEmail(parts.signed);
  if (email === undefined) return refuse("malformed");

  const age = check.now - parts.issuedAt;
  if (!(age <= check.maxAgeMs)) return refuse("expired");

  return { ok: true, value: email };
}
