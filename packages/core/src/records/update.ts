// What an install knows of the newest released poplin: the release it last learned of, and when it last asked. And the form of the address that starts its own rebuild.

import prerelease from "semver/functions/prerelease";
import valid from "semver/functions/valid";
import * as v from "valibot";

import { repository } from "../../../cli/package.json";
import { MOMENT, POSITIVE } from "./fields";

/** The longest address of release notes that is kept. */
const MOST_NOTES_LENGTH = 300;

/** Where the project's releases are, as the package names its repository: the notes of a release the website publishes are that page or one under it. */
const RELEASES = `${repository.url.replace(/^git\+/, "").replace(/\.git$/, "")}/releases`;

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

/**
 * Whether a text is the address of a release's notes: an `https` address written exactly as a URL writes it, with no user name or password before its host.
 *
 * Such a text holds no line break, space, or control character: a URL drops or escapes each of those, so a text with one differs from what the URL writes. It is shown as it is, in a terminal and as a link.
 */
function isNotesAddress(text: string): boolean {
  if (!URL.canParse(text)) return false;

  const address = new URL(text);
  if (address.href !== text) return false;

  return address.protocol === "https:" && address.username === "" && address.password === "";
}

/** A release: its version, the UTC date it came out, the address of its notes, and its schema: how many steps its database has been through, which an install compares with its own. */
export const UPDATE_NEWS = v.strictObject({
  version: v.pipe(v.string(), v.check(isPlainVersion)),
  released: v.pipe(v.string(), v.isoDate()),
  notes: v.pipe(v.string(), v.maxLength(MOST_NOTES_LENGTH), v.check(isNotesAddress)),
  schema: POSITIVE,
});

/** What the install keeps of the updates it starts by itself: the version and the moment of its last try, and the newest version the provider took a start for, `null` while it took none. */
export const AUTO_START = v.strictObject({ version: UPDATE_NEWS.entries.version, at: MOMENT, taken: v.nullable(UPDATE_NEWS.entries.version) });

/** What the install knows of the newest release, as one row keeps it. */
export const UPDATE_CHECK = v.strictObject({
  /** When the install last asked for the newest release. */
  checked_at: MOMENT,

  /** The newest release it has learned of; `null` while none is known. */
  news: v.nullable(UPDATE_NEWS),

  /** When it first learned of that release's version; `null` while none is known. */
  seen_at: v.nullable(MOMENT),

  /** What it keeps of the updates it started by itself; `null` before the first try. */
  auto: v.nullable(AUTO_START),
});

/** A question mark or a number sign: where the query or the fragment of an address starts, an empty one too. */
const QUERY_OR_FRAGMENT = /[?#]/;

/** The notes of a release as the website publishes them: a page of the project's releases and nothing after its path, so a published file sends nobody to any other place. */
const PUBLISHED_NOTES = v.pipe(
  UPDATE_NEWS.entries.notes,
  v.check((notes) => !QUERY_OR_FRAGMENT.test(notes), "the notes of a release hold no query and no fragment"),
  v.check((notes) => notes === RELEASES || notes.startsWith(`${RELEASES}/`), "the notes of a release are a page of the project's releases"),
);

/** The file the website publishes, as JSON text: a release, or a `version` of `null` before the first one. A key a later poplin added is passed over. */
const LATEST_FILE = v.pipe(
  v.string(),
  v.parseJson(),
  v.union([v.object({ version: v.null() }), v.object({ ...UPDATE_NEWS.entries, notes: PUBLISHED_NOTES })]),
);

/** A release, as the install keeps it. */
export type UpdateNews = v.InferOutput<typeof UPDATE_NEWS>;

/** When the install last asked, and what it knows. */
export type UpdateCheck = v.InferOutput<typeof UPDATE_CHECK>;

/** What the install keeps of the updates it starts by itself. */
export type AutoStart = v.InferOutput<typeof AUTO_START>;

/**
 * Read the text of the website's `latest.json` as the newest release.
 *
 * @returns the release, `null` for a file that names none yet, or `undefined` for a text that is not that file, such as one whose notes are no page of the project's releases, or hold a query or a fragment
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
