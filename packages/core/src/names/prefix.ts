// The hostname prefix rule: under the default layout a site's hostname label is the prefix followed by its name.

import type { SecretName, SiteName } from "./names";

/** The prefix a new install starts with. An empty prefix is allowed and leaves labels as they are. */
export const DEFAULT_PREFIX = "page-";

/** A label with its prefix removed, or the refusal of a label that never carried it. */
export type Unprefixed = { readonly ok: true; readonly label: string } | { readonly ok: false; readonly refusal: "missing-prefix" };

/**
 * Remove the prefix from a hostname label.
 *
 * @param label - the first label of a hostname, in lowercase
 * @returns the rest of the label, still unchecked: it is a site name only once `splitLabel` says so
 */
export function stripPrefix(prefix: string, label: string): Unprefixed {
  if (!label.startsWith(prefix)) return { ok: false, refusal: "missing-prefix" };

  return { ok: true, label: label.slice(prefix.length) };
}

/**
 * Build the hostname label of a site's short or secret address.
 *
 * @returns the label `stripPrefix` reads back with the same prefix
 */
export function applyPrefix(prefix: string, name: SiteName | SecretName): string {
  return `${prefix}${name}`;
}
