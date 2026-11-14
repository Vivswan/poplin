// The hostname prefix rule: under the default layout a site's hostname label is the prefix followed by its name.

import { MAX_SECRET_NAME_LENGTH, type SecretName, type SiteName } from "./names";

/** The most characters DNS carries in one hostname label. */
const MAX_LABEL_LENGTH = 63;

/** The longest prefix that still leaves room for the longest secret name. */
const MAX_PREFIX_LENGTH = MAX_LABEL_LENGTH - MAX_SECRET_NAME_LENGTH;

/** The characters a hostname label may hold; a prefix may also be empty. */
const PREFIX_CHARACTERS = /^[a-z0-9-]*$/;

/** The prefix a new install starts with. */
export const DEFAULT_PREFIX = "page-" as Prefix;

declare const prefixBrand: unique symbol;

/** A string that passed `parsePrefix`, or the default; every label built with it fits in DNS. */
export type Prefix = string & { readonly [prefixBrand]: true };

/** Why a string was refused as a prefix. `too-long` means the longest secret address would no longer fit in one label. */
type PrefixRefusal = "too-long" | "bad-character" | "leading-dash";

/** A parsed prefix, or the reason it was refused. */
type CheckedPrefix = { readonly ok: true; readonly value: Prefix } | { readonly ok: false; readonly refusal: PrefixRefusal };

/** A label with its prefix removed, or the refusal of a label that never carried it. */
export type Unprefixed = { readonly ok: true; readonly label: string } | { readonly ok: false; readonly refusal: "missing-prefix" };

/**
 * Decide whether a string is a hostname prefix.
 *
 * @param raw - the prefix as configured; the empty string is a prefix and leaves labels as they are
 * @returns the prefix, or the first rule it breaks
 */
export function parsePrefix(raw: string): CheckedPrefix {
  if (raw.length > MAX_PREFIX_LENGTH) return { ok: false, refusal: "too-long" };

  if (!PREFIX_CHARACTERS.test(raw)) return { ok: false, refusal: "bad-character" };

  if (raw.startsWith("-")) return { ok: false, refusal: "leading-dash" };

  return { ok: true, value: raw as Prefix };
}

/**
 * Remove the prefix from a hostname label.
 *
 * @param label - the first label of a hostname, in lowercase
 * @returns the rest of the label, still unchecked: it is a site name only once `splitLabel` says so
 */
export function stripPrefix(prefix: Prefix, label: string): Unprefixed {
  if (!label.startsWith(prefix)) return { ok: false, refusal: "missing-prefix" };

  return { ok: true, label: label.slice(prefix.length) };
}

/**
 * Build the hostname label of a site's short or secret address.
 *
 * @returns the label `stripPrefix` reads back with the same prefix, never longer than DNS allows
 */
export function applyPrefix(prefix: Prefix, name: SiteName | SecretName): string {
  return `${prefix}${name}`;
}
