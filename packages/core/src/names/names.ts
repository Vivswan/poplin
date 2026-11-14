// The name rules: what a site's name may be, how one is derived from a file or folder, and which names a public site may hold as its address.

/** The most characters a name holds; with `--`, an id, and a suffix it still fits one DNS label. */
export const MAX_NAME_LENGTH = 40;

/** The fewest characters a name holds: a shorter one would put `--` third and fourth in a hostname label, the form URL parsers keep for encoded names. */
const MIN_NAME_LENGTH = 3;

/** The characters a name may hold. */
const NAME_CHARACTERS = /^[a-z0-9-]+$/;

/** What joins a name to an id in a site label, so no name may hold it. */
const DOUBLE_DASH = "--";

/** The ending a file name loses when a name is derived from it. */
const HTML_SUFFIX = ".html";

/** The public names every install keeps for itself: `gallery` before the suffix is the hostname of the gallery page. */
const OWN_PUBLIC_NAMES: ReadonlySet<string> = new Set(["gallery"]);

declare const siteNameBrand: unique symbol;
declare const publicNameBrand: unique symbol;

/** A string that passed `parseSiteName`; no other code can make one. A name is a label in a site's address: any number of sites may share it. */
export type SiteName = string & { readonly [siteNameBrand]: true };

/** A name that may stand alone before the suffix as a public site's hostname label; made by `parsePublicName` alone. */
export type PublicName = SiteName & { readonly [publicNameBrand]: true };

/** Why a string was refused. `reserved` means the name is one of the install's own hostnames; `bad-id` that the part after `--` is no site id. */
type NameRefusal = "empty" | "too-short" | "too-long" | "bad-character" | "leading-dash" | "trailing-dash" | "double-dash" | "reserved" | "bad-id";

/** A parsed value, or the reason it was refused. */
export type Checked<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly refusal: NameRefusal };

function refuse(refusal: NameRefusal): { readonly ok: false; readonly refusal: NameRefusal } {
  return { ok: false, refusal };
}

/**
 * Decide whether a string is a site name.
 *
 * @returns the name, or the first rule it breaks; no word is reserved, since a name is never an address on its own
 */
export function parseSiteName(raw: string): Checked<SiteName> {
  if (raw.length === 0) return refuse("empty");

  if (raw.length < MIN_NAME_LENGTH) return refuse("too-short");

  if (raw.length > MAX_NAME_LENGTH) return refuse("too-long");

  if (!NAME_CHARACTERS.test(raw)) return refuse("bad-character");

  if (raw.startsWith("-")) return refuse("leading-dash");

  if (raw.endsWith("-")) return refuse("trailing-dash");

  if (raw.includes(DOUBLE_DASH)) return refuse("double-dash");

  return { ok: true, value: raw as SiteName };
}

/**
 * Derive a site name from a file or folder name: a trailing `.html` goes and ASCII capitals are lowered.
 *
 * @param entry - the last path segment, not a path
 * @returns the name, or why the entry needs an explicit name; nothing else is rewritten
 */
export function nameFromEntry(entry: string): Checked<SiteName> {
  // ASCII only: `toLowerCase` on the whole string would turn the Kelvin sign into a valid `k`.
  const lowered = entry.replace(/[A-Z]/g, (capital) => capital.toLowerCase());

  if (!lowered.endsWith(HTML_SUFFIX)) return parseSiteName(lowered);

  return parseSiteName(lowered.slice(0, -HTML_SUFFIX.length));
}

/**
 * Decide whether a string may be a public site's public name.
 *
 * @param ownNames - the names this install keeps besides `gallery`: each is a hostname of its own once the suffix follows it, such as an admin hostname that ends in the suffix. Compared as given, so the caller lists them in lowercase
 * @returns the name, or the first rule it breaks
 */
export function parsePublicName(raw: string, ownNames: ReadonlySet<string>): Checked<PublicName> {
  const name = parseSiteName(raw);
  if (!name.ok) return name;

  if (OWN_PUBLIC_NAMES.has(raw) || ownNames.has(raw)) return refuse("reserved");

  return { ok: true, value: raw as PublicName };
}
