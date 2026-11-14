// The address grammar: the first label of every site hostname ends in a word, so routes that start with a wildcard send only site hostnames to the Worker.
//
//   <name>--<id>-p-poplin          a private site, by its label
//   <name>--<id>-u-poplin          an unlisted or a public site, by its label
//   <public name>-<public word>    a public site, by its public name
//
// Only the id of a label address finds the site: the name may be any name or absent, and the letter may be absent.

import type { Site } from "../records/site";
import { parseSiteId, type SiteId } from "../sites/ids";
import { type SiteLabel, siteReference } from "../sites/labels";
import { type PublicName, parsePublicName, type ReservedNames, type SiteName } from "./names";

/** What the hostname label of every label address ends with. The longest is 40 + 2 + 12 + 2 + 7 = 63 characters: a name, `--`, an id, a dash and a letter, and this word; DNS carries 63. */
export const MARKER = "-poplin";

/** The public word of an install that chose none: `docs-page.example.com`. */
export const DEFAULT_PUBLIC_WORD = "page" as PublicWord;

/** What a public word may be. */
const PUBLIC_WORD = /^[a-z]{2,9}$/;

/** A public name that ends like a lettered label address. */
const LETTER_ENDING = /-[pu]$/;

/** What stands before a letter and before a public word. */
const DASH = "-";

declare const publicWordBrand: unique symbol;

/** The word the hostname label of every public-name address ends with, chosen once at install; made by `parsePublicWord` alone, or the default. */
export type PublicWord = string & { readonly [publicWordBrand]: true };

/** The letter before the marker of a label address: `p` for a private site, `u` for an unlisted or a public one. It says where a site is asked for; the stored site alone decides who may open it. */
export type AccessLetter = "p" | "u";

/** What reading a hostname label takes from the install's layout. */
interface LabelLayout {
  readonly publicWord: PublicWord;
  readonly reserved: ReservedNames;
}

/** What a hostname label names: a site by its id, with the name and the letter the label carried, or whichever site holds a public name. The name is never checked against the site's. */
export type HostParts = { readonly kind: "site"; readonly id: SiteId; readonly name?: SiteName; readonly letter?: AccessLetter } | { readonly kind: "public-name"; readonly name: PublicName };

/** What a hostname label is. `not-ours` ends in neither word; `not-found` ends in one around something that names no site. */
type HostLabel = HostParts | { readonly kind: "not-ours" } | { readonly kind: "not-found" };

/**
 * Decide whether a string is a public word.
 *
 * @returns the word for 2 to 9 lowercase letters, else `undefined`
 */
export function parsePublicWord(raw: string): PublicWord | undefined {
  return PUBLIC_WORD.test(raw) ? (raw as PublicWord) : undefined;
}

/**
 * Name the public names a layout keeps for itself.
 *
 * @param own - the names of the layout's own pages, such as the gallery's
 * @returns `own`, and under the public word `poplin` also every name that would read as a label address: one that ends in `-p` or `-u`, or has the form of an id
 */
export function keptPublicNames(publicWord: PublicWord, own: ReadonlySet<string>): ReservedNames {
  if (`${DASH}${publicWord}` !== MARKER) return own;

  return { has: (name) => own.has(name) || LETTER_ENDING.test(name) || parseSiteId(name).ok };
}

/**
 * Name the letter a site's label address carries.
 *
 * @returns `p` for a private site, `u` for an unlisted or a public one
 */
export function letterOf(access: Site["access"]): AccessLetter {
  return access === "private" ? "p" : "u";
}

/**
 * Build the hostname label of a site's label address.
 *
 * @param site - the site's label, or its id alone
 * @returns `<name>--<id>-<letter>-poplin` or `<id>-<letter>-poplin`, which `readHostLabel` reads back; never longer than DNS allows
 */
export function siteHostLabel(site: SiteLabel | SiteId, letter: AccessLetter): string {
  return `${site}${DASH}${letter}${MARKER}`;
}

/**
 * Build the hostname label of a public site's public address.
 *
 * @returns `<public name>-<public word>`, which `readHostLabel` reads back for a name the layout does not keep
 */
export function publicHostLabel(name: PublicName, publicWord: PublicWord): string {
  return `${name}${DASH}${publicWord}`;
}

function isLetter(text: string): text is AccessLetter {
  return text === "p" || text === "u";
}

// An id holds no dash, so a label or an id that ends in a dash and a letter carries the letter.
function readSite(marked: string): HostParts | undefined {
  const last = marked.slice(-1);
  const letter = isLetter(last) && marked.endsWith(`${DASH}${last}`) ? last : undefined;
  const reference = siteReference(letter === undefined ? marked : marked.slice(0, -`${DASH}${letter}`.length));
  if (!reference.ok || reference.value.kind === "public-name") return undefined;

  return {
    kind: "site",
    id: reference.value.id,
    ...(reference.value.kind === "site" ? { name: reference.value.name } : {}),
    ...(letter === undefined ? {} : { letter }),
  };
}

/**
 * Read what a hostname label names.
 *
 * A label address is read first: under the public word `poplin` the two forms share an ending, and `keptPublicNames` keeps every public name that would read as one.
 *
 * @param label - the first label of a hostname, in lowercase
 * @returns what the label names, `not-ours`, or `not-found`; no lookup is made, so a site may still not exist
 */
export function readHostLabel(label: string, layout: LabelLayout): HostLabel {
  const publicEnding = `${DASH}${layout.publicWord}`;
  const site = label.endsWith(MARKER) ? readSite(label.slice(0, -MARKER.length)) : undefined;
  if (site !== undefined) return site;

  if (!label.endsWith(publicEnding)) return label.endsWith(MARKER) ? { kind: "not-found" } : { kind: "not-ours" };

  const publicName = parsePublicName(label.slice(0, -publicEnding.length), layout.reserved);
  if (!publicName.ok) return { kind: "not-found" };

  return { kind: "public-name", name: publicName.value };
}
