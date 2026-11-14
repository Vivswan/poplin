// What the credentials share: random hex, a SHA-256 digest in hex, and a comparison that takes the same time wherever two texts differ.

import { toHex } from "../records/hex";

const KEY_BYTES = 32;
const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const ENCODER = new TextEncoder();

/**
 * Draw random bytes from Web Crypto.
 *
 * @returns lowercase hex, two characters a byte
 */
export function randomHex(byteCount: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteCount)));
}

/**
 * Digest a text.
 *
 * @returns the SHA-256 of its UTF-8 bytes, as 64 lowercase hex characters
 */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest(HMAC.hash, ENCODER.encode(text))));
}

/**
 * Decide whether two texts are equal, in constant time.
 *
 * @returns `true` for equal texts; how long it takes says nothing about where they differ
 */
export async function sameText(left: string, right: string): Promise<boolean> {
  // The platform compares the two MACs in constant time; the key lives for this one comparison.
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(KEY_BYTES)), HMAC, false, ["sign", "verify"]);
  const mac = await crypto.subtle.sign(HMAC.name, key, ENCODER.encode(left));

  return crypto.subtle.verify(HMAC.name, key, mac, ENCODER.encode(right));
}
