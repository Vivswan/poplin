// The one place a row of the secrets table becomes what the install uses: the visitor key as bytes. It leaves the database in no other record.

import { hexToUint8Array, uint8ArrayToHex } from "uint8array-extras";
import * as v from "valibot";

/** The fewest bytes a visitor key holds. */
const KEY_BYTES = 32;

/** A row of the secrets table: the key as lowercase hex, whole bytes, at least 32 of them. */
const SECRET_ROW = v.object({ value: v.pipe(v.string(), v.regex(/^(?:[0-9a-f]{2})+$/), v.minLength(KEY_BYTES * 2)) });

/**
 * Turn the bytes of a visitor key into the text a row holds.
 *
 * @returns lowercase hex, two characters a byte
 * @throws {RangeError} the key is under 32 bytes
 */
export function visitorKeyToText(key: Uint8Array): string {
  if (key.length < KEY_BYTES) throw new RangeError(`a visitor key holds at least ${KEY_BYTES} bytes, not ${key.length}`);

  return uint8ArrayToHex(key);
}

/**
 * Turn a row of the secrets table into the bytes of the visitor key.
 *
 * @throws {Error} the row holds no visitor key; the message never quotes what is stored
 */
export function visitorKeyFromRow(row: unknown): Uint8Array<ArrayBuffer> {
  const parsed = v.safeParse(SECRET_ROW, row);
  if (!parsed.success) throw new Error("the stored visitor key is not a key");

  return hexToUint8Array(parsed.output.value);
}
