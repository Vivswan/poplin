// The manifest of a release's built files: the one file the website publishes a digest for, which names every built file with its own digest and size.
//
//   the website's `releases.json`   --digest-->   the manifest   --digest and size, per file-->   each built file
//
// A manifest that cannot be read is refused with one sentence, for the first thing wrong in it: `SENTENCES` holds them.
// A key this file does not name is passed over: the provider's part of the manifest is one, and a later poplin may add another.

import * as v from "valibot";

import { POSITIVE } from "./fields";
import { DIGEST, releaseDigest } from "./release";
import { UPDATE_NEWS } from "./update";

/** The name of a built file: lowercase letters and digits, in parts with one dot between them, such as `worker.js.map`. It holds no slash and cannot be a key every record has. */
const FILE_NAME = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/;

/** What is said of a text that is no manifest at all. */
const NO_MANIFEST = "is not a manifest";

/** What is said of a manifest for the key that is wrong in it, or missing from it. */
const SENTENCES: Readonly<Record<string, string>> = {
  version: "names no version such as 0.2.0",
  schema: "gives a schema that is not a whole number from 1 up",
  files: "names no file",
  sha256: "gives a digest that is not 64 lowercase hex characters",
  bytes: "gives a size that is not a whole number of bytes from 1 up",
};

/** What is said of a file whose name is not one. */
const NO_NAME = "names a file whose name is not lowercase letters, digits, and single dots";

/** One built file as the manifest states it. */
const BUNDLE_FILE = v.object({
  /** The SHA-256 digest of its bytes. */
  sha256: v.pipe(v.string(), v.regex(DIGEST)),

  /** How many bytes it holds. */
  bytes: POSITIVE,
});

/** The built files, by name, one at least. A list is refused first: a record takes one. A key every object has, such as `constructor`, is passed over by the record, and so names no file. */
const BUNDLE_FILES = v.pipe(
  v.custom<Record<string, unknown>>((files) => typeof files === "object" && files !== null && !Array.isArray(files)),
  v.check((files) => Object.keys(files).every((name) => FILE_NAME.test(name)), NO_NAME),
  v.record(v.string(), BUNDLE_FILE),
  v.minEntries(1),
);

/** The portable part of a manifest, as JSON text. A list is refused first: an object schema takes one. */
const RELEASE_BUNDLE = v.pipe(
  v.string(),
  v.parseJson(),
  v.check((parsed) => !Array.isArray(parsed)),
  v.object({
    /** The version the built files are of. */
    version: UPDATE_NEWS.entries.version,

    /** How many steps the database of that version has been through. */
    schema: UPDATE_NEWS.entries.schema,

    /** Every built file. */
    files: BUNDLE_FILES,
  }),
);

/** The portable part of a manifest. */
type ReleaseBundle = Readonly<v.InferOutput<typeof RELEASE_BUNDLE>>;

/** A manifest that was read, or what is wrong with its text: the end of a sentence that starts with which manifest it is. */
type Read = { readonly ok: true; readonly bundle: ReleaseBundle } | { readonly ok: false; readonly problem: string };

/** The sentence for the first thing wrong: by the innermost key the manifest names there, or the name rule's own. */
function sentenceOf(issue: v.BaseIssue<unknown>): string {
  if (issue.message === NO_NAME) return NO_NAME;

  const keys = (issue.path ?? []).map((item) => String(item.key));
  const known = keys.reverse().find((key) => Object.hasOwn(SENTENCES, key));

  return known === undefined ? NO_MANIFEST : (SENTENCES[known] ?? NO_MANIFEST);
}

/**
 * Read the text of a release's manifest.
 *
 * @returns the manifest's portable part, or the sentence for the first thing wrong
 */
export function readBundle(text: string): Read {
  const read = v.safeParse(RELEASE_BUNDLE, text, { abortEarly: true });

  return read.success ? { ok: true, bundle: read.output } : { ok: false, problem: sentenceOf(read.issues[0]) };
}

/**
 * Check the bytes fetched for one built file against the manifest that names it.
 *
 * @param name - the file's name as the manifest writes it, such as `worker.js`
 * @returns `undefined` for the file the manifest states, or what differs: the end of a sentence that starts with which file it is
 */
export async function bundleFileProblem(bundle: ReleaseBundle, name: string, bytes: Uint8Array<ArrayBuffer>): Promise<string | undefined> {
  const stated = Object.hasOwn(bundle.files, name) ? bundle.files[name] : undefined;
  if (stated === undefined) return "is not named by the manifest";

  if (bytes.byteLength !== stated.bytes) return `holds ${bytes.byteLength} bytes, and the manifest says ${stated.bytes}`;

  return (await releaseDigest(bytes)) === stated.sha256 ? undefined : "has another SHA-256 digest than the manifest says";
}
