// The owner's session value: a signed token (JWT, HS256) naming an email, with the time it was issued and the time it ends.
//
//   sub  the email, in its normal form
//   iat  issue time, seconds
//   exp  end time, seconds

import { errors, jwtVerify, SignJWT } from "jose";
import { type Login, parseLogin } from "./logins";

const MAX_VALUE_LENGTH = 1024;
const ALGORITHM = "HS256";
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;

/** Why a session value was refused. `bad-signature` covers a changed value and a value signed under another key. */
type SessionRefusal = "malformed" | "bad-signature" | "expired";

/** The email a session value names, or the reason the value was refused. */
export type CheckedSession = { readonly ok: true; readonly value: Login } | { readonly ok: false; readonly refusal: SessionRefusal };

/** What a session value is built from. `issuedAt` is whole milliseconds since the epoch, `maxAgeMs` how long the value lives, in milliseconds; `key` comes from `importSessionKey`. */
export type SessionFacts = { readonly email: Login; readonly issuedAt: number; readonly maxAgeMs: number; readonly key: CryptoKey };

/** What a session value is checked against. `now` is milliseconds since the epoch. */
export type SessionCheck = { readonly key: CryptoKey; readonly now: number };

function refuse(refusal: SessionRefusal): { readonly ok: false; readonly refusal: SessionRefusal } {
  return { ok: false, refusal };
}

function refusalOf(error: unknown): SessionRefusal {
  if (error instanceof errors.JWSSignatureVerificationFailed) return "bad-signature";

  if (error instanceof errors.JWTExpired) return "expired";

  if (error instanceof errors.JOSEError) return "malformed";

  throw error;
}

function signedEmail(subject: unknown): Login | undefined {
  if (typeof subject !== "string") return undefined;

  const login = parseLogin(subject);

  // Only the normal form is ever signed.
  if (!login.ok || login.value !== subject) return undefined;

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
 * @returns a string of letters, digits, `-`, `_`, and `.`; safe as a cookie value and in a URL. Times are kept in whole seconds, rounded down
 */
export function buildSession(facts: SessionFacts): Promise<string> {
  const issuedAt = Math.floor(facts.issuedAt / 1000);

  return new SignJWT()
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(facts.email)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + Math.floor(facts.maxAgeMs / 1000))
    .sign(facts.key);
}

/**
 * Decide whether a string is a live session value.
 *
 * @param value - untrusted text; no claim in it is read before the signature holds
 * @returns the email, or the reason for refusal; never throws on any `value`. A value issued after `now` is live, so clocks may disagree a little
 */
export async function verifySession(value: string, check: SessionCheck): Promise<CheckedSession> {
  if (value.length > MAX_VALUE_LENGTH) return refuse("malformed");

  // A clock that is no date would compare as "not yet ended".
  const currentDate = new Date(check.now);
  if (Number.isNaN(currentDate.getTime())) return refuse("expired");

  try {
    const { payload } = await jwtVerify(value, check.key, { algorithms: [ALGORITHM], currentDate, requiredClaims: ["sub", "iat", "exp"] });
    const email = signedEmail(payload.sub);

    return email === undefined ? refuse("malformed") : { ok: true, value: email };
  } catch (error) {
    return refuse(refusalOf(error));
  }
}
