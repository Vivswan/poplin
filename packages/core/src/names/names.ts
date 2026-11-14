// The site-name rules: what a name may be, its secret form, and how a hostname label splits back into them.

const MAX_NAME_LENGTH = 40;
const NAME_CHARACTERS = /^[a-z0-9-]+$/;
const SECRET_SEPARATOR = "--";
const SECRET_LENGTH = 12;
const SECRET_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const SECRET_PATTERN = /^[0-9a-z]{12}$/;
const UNBIASED_BYTE_LIMIT = 256 - (256 % SECRET_ALPHABET.length);
const HTML_SUFFIX = ".html";

declare const siteNameBrand: unique symbol;
declare const secretNameBrand: unique symbol;

/** A string that passed `parseSiteName`; no other code can make one. */
export type SiteName = string & { readonly [siteNameBrand]: true };

/** A site name followed by `--` and its secret; made by `secretName` alone. */
export type SecretName = string & { readonly [secretNameBrand]: true };

/** Why a string was refused. `reserved` means the caller's reserved set holds the name. */
export type NameRefusal =
  | "empty"
  | "too-long"
  | "bad-character"
  | "leading-dash"
  | "trailing-dash"
  | "double-dash"
  | "reserved"
  | "bad-secret";

/** A parsed value, or the reason it was refused. */
export type Checked<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly refusal: NameRefusal };

/** The parts of a hostname label: a secret is present only on a site's secret address. */
export type LabelParts = { readonly name: SiteName } | { readonly name: SiteName; readonly secret: string };

function refuse(refusal: NameRefusal): { readonly ok: false; readonly refusal: NameRefusal } {
  return { ok: false, refusal };
}

function randomSecret(): string {
  let secret = "";

  while (secret.length < SECRET_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(SECRET_LENGTH));

    for (const byte of bytes) {
      // A byte past the last whole run of the alphabet would favour its first symbols.
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      if (secret.length === SECRET_LENGTH) break;

      secret += SECRET_ALPHABET[byte % SECRET_ALPHABET.length];
    }
  }

  return secret;
}

/**
 * Decide whether a string is a site name.
 *
 * @param reserved - names refused although well formed; compared as given, so the caller lists them in lowercase
 * @returns the name, or the first rule it breaks
 */
export function parseSiteName(raw: string, reserved: ReadonlySet<string>): Checked<SiteName> {
  if (raw.length === 0) return refuse("empty");

  if (raw.length > MAX_NAME_LENGTH) return refuse("too-long");

  if (!NAME_CHARACTERS.test(raw)) return refuse("bad-character");

  if (raw.startsWith("-")) return refuse("leading-dash");

  if (raw.endsWith("-")) return refuse("trailing-dash");

  if (raw.includes(SECRET_SEPARATOR)) return refuse("double-dash");

  if (reserved.has(raw)) return refuse("reserved");

  return { ok: true, value: raw as SiteName };
}

/**
 * Derive a site name from a file or folder name: a trailing `.html` goes and ASCII capitals are lowered.
 *
 * @param entry - the last path segment, not a path
 * @returns the name, or why the entry needs an explicit name; nothing else is rewritten
 */
export function nameFromEntry(entry: string, reserved: ReadonlySet<string>): Checked<SiteName> {
  // ASCII only: `toLowerCase` on the whole string would turn the Kelvin sign into a valid `k`.
  const lowered = entry.replace(/[A-Z]/g, (capital) => capital.toLowerCase());

  if (!lowered.endsWith(HTML_SUFFIX)) return parseSiteName(lowered, reserved);

  return parseSiteName(lowered.slice(0, -HTML_SUFFIX.length), reserved);
}

/**
 * Build a fresh secret name for a site.
 *
 * @returns `<name>--<12 base36 characters>`, about 62 bits drawn from Web Crypto on every call
 */
export function secretName(name: SiteName): SecretName {
  return `${name}${SECRET_SEPARATOR}${randomSecret()}` as SecretName;
}

/**
 * Split a hostname label into its site name and, on a secret address, its secret.
 *
 * @param label - the label with any hostname prefix already stripped, in lowercase
 * @returns the parts, or why the label names no site; a secret is only checked for its form, not that it is the site's
 */
export function splitLabel(label: string, reserved: ReadonlySet<string>): Checked<LabelParts> {
  // A name never holds `--` or ends in a dash, so the first `--` is the separator.
  const separatorAt = label.indexOf(SECRET_SEPARATOR);

  if (separatorAt === -1) {
    const short = parseSiteName(label, reserved);
    if (!short.ok) return short;

    return { ok: true, value: { name: short.value } };
  }

  const name = parseSiteName(label.slice(0, separatorAt), reserved);
  if (!name.ok) return name;

  const secret = label.slice(separatorAt + SECRET_SEPARATOR.length);
  if (!SECRET_PATTERN.test(secret)) return refuse("bad-secret");

  return { ok: true, value: { name: name.value, secret } };
}
