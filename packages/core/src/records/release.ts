// The releases an install may take: the project's website publishes each version with the SHA-256 digest of its files, and an install runs no files that do not match.
//
//   older than the version that runs, when the taker gives one   older            nothing is fetched
//   no digest published for the version                          no_digest        nothing is fetched
//   the files cannot be fetched                                  unreachable
//   the digest of the fetched files differs                      digest_differs   the files are read no further
//   the files say they are another version, or none              other_version
//   all of the above passed                                      the files, to run
//
// A release is named by its version and taken by its content: where the files come from is trusted for nothing.

import lt from "semver/functions/lt";
import rsort from "semver/functions/rsort";
import { uint8ArrayToHex } from "uint8array-extras";
import * as v from "valibot";

import { isPlainVersion } from "./update";

/** A SHA-256 digest as it is published: 64 lowercase hex characters. */
const DIGEST = /^[0-9a-f]{64}$/;

/** The file the website publishes, as JSON text: every release an install may take, by its version, with the digest of its source files. The keys are checked first: a record takes a list, and passes over a key such as `constructor`. */
const RELEASE_PINS = v.pipe(
  v.string(),
  v.parseJson(),
  v.check((parsed) => typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).every(isPlainVersion)),
  v.record(v.pipe(v.string(), v.check(isPlainVersion)), v.object({ source: v.pipe(v.string(), v.regex(DIGEST)) })),
);

/** Every release an install may take, by its version. */
export type ReleasePins = Readonly<v.InferOutput<typeof RELEASE_PINS>>;

/** Why a release is not taken; the table at the top of this file says when. */
export type ReleaseRefusal = "older" | "no_digest" | "unreachable" | "digest_differs" | "other_version";

/** The release to take. */
interface Wanted {
  /** Its version. */
  readonly version: string;

  /** The version that runs now, from a taker that never goes below it; left out by one that takes any version a person names. */
  readonly running?: string;
}

/** How the files of a release are reached. */
interface ReleaseFiles {
  /** Fetches the files of a version as one run of bytes; `undefined` when they cannot be fetched. */
  readonly fetch: (version: string) => Promise<Uint8Array<ArrayBuffer> | undefined>;

  /** Reads the version the files say they are; `undefined` when they say none. It is handed only bytes whose digest matched. */
  readonly versionOf: (bytes: Uint8Array<ArrayBuffer>) => Promise<string | undefined>;
}

/** The files of a release that passed, or why it is not taken; `says` is the version the files gave for `other_version`. */
type Checked = { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> } | { readonly ok: false; readonly refusal: ReleaseRefusal; readonly says?: string };

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

/**
 * Fetch the files of a release and take them only when they are the files the website published for that version.
 *
 * @returns the files, or the refusal the table at the top of this file names; nothing is fetched for the first two
 * @throws whatever `files.versionOf` throws
 */
export async function checkedRelease(wanted: Wanted, pins: ReleasePins, files: ReleaseFiles): Promise<Checked> {
  if (wanted.running !== undefined && lt(wanted.version, wanted.running)) return { ok: false, refusal: "older" };

  const pin = Object.hasOwn(pins, wanted.version) ? pins[wanted.version] : undefined;
  if (pin === undefined) return { ok: false, refusal: "no_digest" };

  const bytes = await files.fetch(wanted.version);
  if (bytes === undefined) return { ok: false, refusal: "unreachable" };

  if ((await releaseDigest(bytes)) !== pin.source) return { ok: false, refusal: "digest_differs" };

  const says = await files.versionOf(bytes);
  if (says !== wanted.version) return { ok: false, refusal: "other_version", ...(says === undefined ? {} : { says }) };

  return { ok: true, bytes };
}
