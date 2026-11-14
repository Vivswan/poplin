// The one place the stored signing key becomes bytes, and bytes become what is stored. The key leaves the database in no other record.

import * as v from "valibot";

import { toHex } from "./hex";

/** The fewest bytes a signing key holds: the output size of HMAC-SHA-256. */
const KEY_BYTES = 32;

/** Two lowercase hex characters, one byte. */
const HEX_BYTE = /[0-9a-f]{2}/g;

/** A row of the secrets table: the key as lowercase hex, whole bytes, at least 32 of them. */
const SECRET_ROW = v.object({ value: v.pipe(v.string(), v.regex(/^(?:[0-9a-f]{2})+$/), v.minLength(KEY_BYTES * 2)) });

/**
 * Turn the bytes of a signing key into the text a row holds.
 *
 * @returns lowercase hex, two characters a byte
 * @throws {RangeError} the key is under 32 bytes
 */
export function signingKeyToText(key: Uint8Array): string {
  if (key.length < KEY_BYTES) throw new RangeError(`a signing key holds at least ${KEY_BYTES} bytes, not ${key.length}`);

  return toHex(key);
}

/**
 * Turn a row of the secrets table into the bytes of the signing key.
 *
 * @throws {Error} the row holds no signing key; the message never quotes what is stored
 */
export function signingKeyFromRow(row: unknown): Uint8Array<ArrayBuffer> {
  const parsed = v.safeParse(SECRET_ROW, row);
  if (!parsed.success) throw new Error("the stored signing key is not a key");

  return Uint8Array.from(parsed.output.value.match(HEX_BYTE) ?? [], (pair) => Number.parseInt(pair, 16));
}
