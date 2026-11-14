// The hostname suffix rule: a site's hostname label ends in a marker, so one route that starts with a wildcard sends only site hostnames to the Worker.

import { type LabelParts, MAX_SITE_LABEL_LENGTH, type SiteLabel, splitLabel } from "../sites/labels";
import type { PublicName } from "./names";

/** The most characters DNS carries in one hostname label. */
const MAX_LABEL_LENGTH = 63;

/** The longest suffix that still leaves room for the longest site label. */
const MAX_SUFFIX_LENGTH = MAX_LABEL_LENGTH - MAX_SITE_LABEL_LENGTH;

/** The characters a hostname label may hold. */
const SUFFIX_CHARACTERS = /^[a-z0-9-]+$/;

/** What a suffix starts with, so it stands apart from the name or the id before it. */
const DASH = "-";

/** The suffix a new install starts with. */
export const DEFAULT_SUFFIX = "-page" as Suffix;

declare const suffixBrand: unique symbol;

/** A string that passed `parseSuffix`, or the default; never empty, and every label built with it fits in DNS. */
export type Suffix = string & { readonly [suffixBrand]: true };

/** Why a string was refused as a suffix. `too-long` means the longest site label would no longer fit in one DNS label. */
type SuffixRefusal = "empty" | "too-long" | "bad-character" | "no-leading-dash" | "trailing-dash" | "double-dash";

/** A parsed suffix, or the reason it was refused. */
type CheckedSuffix = { readonly ok: true; readonly value: Suffix } | { readonly ok: false; readonly refusal: SuffixRefusal };

/** A label with its suffix removed, or the refusal of a label that never carried it. */
type Unsuffixed = { readonly ok: true; readonly label: string } | { readonly ok: false; readonly refusal: "not-ours" };

/** What a hostname label names. `not-ours` lacks the suffix; `not-found` carries it around something that is neither a site label nor a name. */
type HostLabel = LabelParts | { readonly kind: "not-ours" } | { readonly kind: "not-found" };

/**
 * Decide whether a string is a hostname suffix.
 *
 * @param raw - the suffix as configured: a dash, then letters, digits, and single dashes, not ending in a dash
 * @returns the suffix, or the first rule it breaks; the empty string is refused
 */
export function parseSuffix(raw: string): CheckedSuffix {
  if (raw.length === 0) return { ok: false, refusal: "empty" };

  if (raw.length > MAX_SUFFIX_LENGTH) return { ok: false, refusal: "too-long" };

  if (!SUFFIX_CHARACTERS.test(raw)) return { ok: false, refusal: "bad-character" };

  if (!raw.startsWith(DASH)) return { ok: false, refusal: "no-leading-dash" };

  if (raw.endsWith(DASH)) return { ok: false, refusal: "trailing-dash" };

  if (raw.includes(`${DASH}${DASH}`)) return { ok: false, refusal: "double-dash" };

  return { ok: true, value: raw as Suffix };
}

/**
 * Build the hostname label of a site's address, or of a public site's public address.
 *
 * @param site - a site's label, or the public name a public site holds
 * @returns the label `stripSuffix` reads back with the same suffix, never longer than DNS allows
 */
export function applySuffix(suffix: Suffix, site: SiteLabel | PublicName): string {
  return `${site}${suffix}`;
}

/**
 * Remove the suffix from a hostname label.
 *
 * @param label - the first label of a hostname, in lowercase
 * @returns the rest of the label, still unchecked; or `not-ours` for a label that does not end in the suffix
 */
export function stripSuffix(suffix: Suffix, label: string): Unsuffixed {
  if (!label.endsWith(suffix)) return { ok: false, refusal: "not-ours" };

  return { ok: true, label: label.slice(0, label.length - suffix.length) };
}

/**
 * Read what a hostname label names.
 *
 * @param label - the first label of a hostname, in lowercase
 * @param reserved - the names the install's address layout keeps for itself; a label around one is `not-found`
 * @returns `site` with the name and id of a label holding `--`, `public-name` for a name alone, `not-ours`, or `not-found`; no lookup is made, so a site may still not exist
 */
export function readHostLabel(suffix: Suffix, label: string, reserved: ReadonlySet<string>): HostLabel {
  const stripped = stripSuffix(suffix, label);
  if (!stripped.ok) return { kind: "not-ours" };

  const parts = splitLabel(stripped.label, reserved);
  if (!parts.ok) return { kind: "not-found" };

  return parts.value;
}
