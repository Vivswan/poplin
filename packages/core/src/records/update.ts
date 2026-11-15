// What an install knows of the newest released poplin: the release it last learned of, and when it last asked. And the form of the address that starts its own rebuild.

import prerelease from "semver/functions/prerelease";
import valid from "semver/functions/valid";
import * as v from "valibot";

import { MOMENT } from "./fields";

/** The longest address of release notes that is kept. */
const MOST_NOTES_LENGTH = 300;

/** The longest address that starts a rebuild. */
const MOST_ADDRESS_LENGTH = 2048;

/**
 * Whether a text is a released version as it is written: three whole numbers with dots between them, such as `0.2.0`.
 *
 * A version before its release, one with build words, a `v` in front, or spaces around it is not: such a version is compared with nothing.
 */
export function isPlainVersion(text: string): boolean {
  return valid(text) === text && prerelease(text) === null;
}

/** A release: its version, the UTC date it came out, the address of its notes, and whether updating to it changes the database. */
export const UPDATE_NEWS = v.strictObject({
  version: v.pipe(v.string(), v.check(isPlainVersion)),
  released: v.pipe(v.string(), v.isoDate()),
  notes: v.pipe(v.string(), v.maxLength(MOST_NOTES_LENGTH), v.startsWith("https://"), v.url()),
  database: v.boolean(),
});

/** The last time the install asked for the newest release, and the newest it has learned of; `null` while no release is known. */
export const UPDATE_CHECK = v.strictObject({ checked_at: MOMENT, news: v.nullable(UPDATE_NEWS) });

/** The file the website publishes, as JSON text: a release, or a `version` of `null` before the first one. `database: true` says updating to the release changes the database, and a file without the key says it does not. */
const LATEST_FILE = v.pipe(
  v.string(),
  v.parseJson(),
  v.union([v.object({ version: v.null() }), v.object({ ...UPDATE_NEWS.entries, database: v.optional(UPDATE_NEWS.entries.database, false) })]),
);

/** A release, as the install keeps it. */
export type UpdateNews = v.InferOutput<typeof UPDATE_NEWS>;

/** When the install last asked, and what it knows. */
export type UpdateCheck = v.InferOutput<typeof UPDATE_CHECK>;

/**
 * Read the text of the website's `latest.json` as the newest release.
 *
 * @returns the release, `null` for a file that names none yet, or `undefined` for a text that is not that file
 */
export function publishedRelease(text: string): UpdateNews | null | undefined {
  const latest = v.safeParse(LATEST_FILE, text);
  if (!latest.success) return undefined;

  return latest.output.version === null ? null : latest.output;
}

/**
 * Read a typed address as one that starts a rebuild of the install.
 *
 * The portable rules are checked here: `https`, no user or password, no port, no fragment, 2048 characters at most. Which hosts and paths count is the provider's to say.
 *
 * @param accepts - whether the host's provider starts rebuilds at this address
 * @returns the address as a URL writes it, or `undefined` for anything else; a request is sent to no address this refused
 */
export function rebuildAddress(typed: string, accepts: (address: URL) => boolean): string | undefined {
  if (typed.length > MOST_ADDRESS_LENGTH || !URL.canParse(typed)) return undefined;

  const address = new URL(typed);
  if (address.protocol !== "https:" || address.username !== "" || address.password !== "") return undefined;

  if (address.port !== "" || address.hash !== "" || typed.includes("#")) return undefined;

  return accepts(address) ? address.href : undefined;
}
