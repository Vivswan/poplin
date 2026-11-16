// The upload key as the Worker keeps it: an API token of the account that reaches the objects of the install's one bucket and nothing else, held in the form the bucket's own API takes.
//
//   id          the token's id, which that API takes as the access key id
//   secret      the SHA-256 of the token's value in hexadecimal, which it takes as the secret; the value itself is kept nowhere
//   bucket      the name of the install's bucket, with its jurisdiction where it was made in one
//   minted_at   the moment the key was made, in milliseconds since the epoch
//
// The bucket's API refuses a new key for about two minutes after it is made, so a key is used only once it is two and a half minutes old.
// Nothing here logs, and no answer of the Worker carries any part of it.

import { sha256Hex } from "@poplin/core/src/auth/util";
import * as v from "valibot";

/** The secret as its one text holds it. An id is put into an address, and a bucket's name and jurisdiction into a hostname and a path, so each is held to the characters those take. */
const UPLOAD_KEY = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^[\w-]{1,64}$/)),
  secret: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
  bucket: v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)),
  jurisdiction: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9]{1,32}$/))),
  minted_at: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
});

/** The secret's one text, read as JSON of that form. */
const UPLOAD_KEY_TEXT = v.pipe(v.string(), v.parseJson(), UPLOAD_KEY);

/** How long after it is made a key is left unused, in milliseconds: the bucket's API refuses a new key for about two minutes. */
const SETTLING_MS = 150_000;

/** The upload key, read. */
export type UploadKey = Readonly<v.InferOutput<typeof UPLOAD_KEY>>;

/**
 * Read the Worker's secret as the upload key.
 *
 * @param raw - the secret as the Worker was handed it, unchecked
 * @returns the key, or `undefined` for a secret that is absent, no text, no JSON, or JSON of any other form
 */
export function readUploadKey(raw: unknown): UploadKey | undefined {
  const read = v.safeParse(UPLOAD_KEY_TEXT, raw);

  return read.success ? read.output : undefined;
}

/**
 * Write a new token as the text of the Worker's secret.
 *
 * @param made - the token's id and its value, of which only the hash is written
 * @param bucket - the install's bucket
 * @param mintedAt - the moment the token was made, in milliseconds since the epoch
 * @returns the `text` that `readUploadKey` reads, and the `secret` inside it
 */
export async function uploadKeyText(
  made: { readonly id: string; readonly value: string },
  bucket: { readonly name: string; readonly jurisdiction?: string | undefined },
  mintedAt: number,
): Promise<{ readonly text: string; readonly secret: string }> {
  const secret = await sha256Hex(made.value);
  const key: UploadKey = { id: made.id, secret, bucket: bucket.name, ...(bucket.jurisdiction === undefined ? {} : { jurisdiction: bucket.jurisdiction }), minted_at: mintedAt };

  return { text: JSON.stringify(key), secret };
}

/**
 * Decide whether a key is old enough for the bucket's API to take it.
 *
 * @param now - the moment asked about, in milliseconds since the epoch
 * @returns whether the key was made two and a half minutes ago or longer; a key younger than that, or one a clock set back makes look so, is left unused
 */
export function isSettled(key: UploadKey, now: number): boolean {
  return now - key.minted_at >= SETTLING_MS;
}
