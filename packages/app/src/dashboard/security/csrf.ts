// The token every dashboard form carries back, so a page of another origin cannot post for the owner.
//
//   <issue time, ms> . <hex HMAC-SHA-256 of "poplin-dashboard-csrf", the email, and the issue time>
//
// It is bound to the email of the session and lives twelve hours. Nothing is stored: the token is checked against the key alone.

import { hexToUint8Array, uint8ArrayToHex } from "uint8array-extras";

const LIFETIME_MS = 12 * 60 * 60 * 1000;
const MIN_SECRET_BYTES = 32;
const PURPOSE = "poplin-dashboard-csrf";
const TOKEN_PATTERN = /^(0|[1-9][0-9]{0,15})\.([0-9a-f]{64})$/;
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const ENCODER = new TextEncoder();

/** What a token is made for and checked against. `now` is milliseconds since the epoch; `key` comes from `importCsrfKey`. */
interface Binding {
  readonly key: CryptoKey;
  readonly email: string;
  readonly now: number;
}

function signedText(email: string, issuedAt: number): Uint8Array<ArrayBuffer> {
  return ENCODER.encode(`${PURPOSE}\n${email}\n${issuedAt}`);
}

/**
 * Turn secret bytes into the key that signs and verifies the tokens.
 *
 * @param secret - random bytes kept apart from every other secret's use; a new secret ends every open form
 * @returns an HMAC-SHA-256 key that cannot be exported
 * @throws {RangeError} the secret is under 32 bytes
 */
export function importCsrfKey(secret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (secret.byteLength < MIN_SECRET_BYTES) throw new RangeError(`the CSRF secret holds ${secret.byteLength} bytes, under ${MIN_SECRET_BYTES}`);

  return crypto.subtle.importKey("raw", secret, HMAC, false, ["sign", "verify"]);
}

/**
 * Build the token for the forms of one answer.
 *
 * @returns digits, a dot, and 64 hex characters
 */
export async function mintCsrfToken(binding: Binding): Promise<string> {
  const signature = await crypto.subtle.sign(HMAC.name, binding.key, signedText(binding.email, binding.now));

  return `${binding.now}.${uint8ArrayToHex(signature)}`;
}

/**
 * Decide whether a posted token was made for this email under this key, at most twelve hours ago.
 *
 * @param token - untrusted text
 * @returns `false` for anything else; never throws. The signature is compared by Web Crypto's `verify`, which takes the same time wherever two signatures differ
 */
export async function checkCsrfToken(token: string, binding: Binding): Promise<boolean> {
  const [, issued, signature] = TOKEN_PATTERN.exec(token) ?? [];
  if (issued === undefined || signature === undefined) return false;

  const issuedAt = Number(issued);
  const genuine = await crypto.subtle.verify(HMAC.name, binding.key, hexToUint8Array(signature), signedText(binding.email, issuedAt));
  if (!genuine) return false;

  return binding.now - issuedAt <= LIFETIME_MS;
}
