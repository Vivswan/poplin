// The random text the install mints: one alphabet and one length for each kind of id and code, every character as likely as any other.
//
//   site-id      12 of 36   62 bits   the unguessable part of a site's address
//   site-folder  16 of 36   82 bits
//   upload-id    16 of 36   82 bits
//   login-code    8 of 20   34 bits   read by a person, with no vowel and no look-alike

import { customAlphabet } from "nanoid";

/** The digits and the small letters. */
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** The capitals a person reads without doubt. */
const CONSONANTS = "BCDFGHJKLMNPQRSTVWXZ";

/** What each kind is drawn from, how long it is, and its maker; a kind's validator spells the same form. */
export const RANDOM_SHAPES = {
  "site-id": shaped(BASE36, 12),
  "site-folder": shaped(BASE36, 16),
  "upload-id": shaped(BASE36, 16),
  "login-code": shaped(CONSONANTS, 8),
} as const;

type Shape = { readonly alphabet: string; readonly length: number; readonly draw: () => string };

function shaped(alphabet: string, length: number): Shape {
  return { alphabet, length, draw: customAlphabet(alphabet, length) };
}

/**
 * Draw the random text of one kind from Web Crypto.
 *
 * @returns text of the kind's length over the kind's alphabet; whether a record already holds it is for whoever stores it to answer
 */
export function randomText(kind: keyof typeof RANDOM_SHAPES): string {
  return RANDOM_SHAPES[kind].draw();
}
