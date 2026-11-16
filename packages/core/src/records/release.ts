// The releases an install may take: the project's website publishes each version with the SHA-256 digest of the manifest of its built files, and its schema. An install runs no files that do not match.
//
// A release is named by its version and taken by its content: where the files come from is trusted for nothing.

import rsort from "semver/functions/rsort";
import { uint8ArrayToHex } from "uint8array-extras";
import * as v from "valibot";

import { isPlainVersion, UPDATE_NEWS } from "./update";

/** A SHA-256 digest as it is published: 64 lowercase hex characters. */
export const DIGEST = /^[0-9a-f]{64}$/;

/** One release as the website publishes it. A key a later poplin added is passed over: installs of every older version read the file. */
const RELEASE_PIN = v.object({
  /** The digest of the manifest of its built files. */
  bundle: v.pipe(v.string(), v.regex(DIGEST)),

  /** How many steps its database has been through. */
  schema: UPDATE_NEWS.entries.schema,
});

/** The file the website publishes, as JSON text: every release an install may take, by its version, with what `RELEASE_PIN` holds. The keys are checked first: a record takes a list, and passes over a key such as `constructor`. */
const RELEASE_PINS = v.pipe(
  v.string(),
  v.parseJson(),
  v.check((parsed) => typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).every(isPlainVersion)),
  v.record(v.pipe(v.string(), v.check(isPlainVersion)), RELEASE_PIN),
);

/** Every release an install may take, by its version. */
export type ReleasePins = Readonly<v.InferOutput<typeof RELEASE_PINS>>;

/**
 * Read the text of the website's `releases.json`.
 *
 * @returns the releases, none for a file that names none yet, or `undefined` for a text that is not that file
 */
export function publishedPins(text: string): ReleasePins | undefined {
  const pins = v.safeParse(RELEASE_PINS, text);

  return pins.success ? pins.output : undefined;
}

/**
 * Pick the highest version among the published releases.
 *
 * @returns the version, or `undefined` when none is published
 */
export function newestPinned(pins: ReleasePins): string | undefined {
  return rsort(Object.keys(pins))[0];
}

/**
 * Digest the files of a release as the website publishes it.
 *
 * @returns the SHA-256 of the bytes, as 64 lowercase hex characters
 */
export async function releaseDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return uint8ArrayToHex(await crypto.subtle.digest("SHA-256", bytes));
}
