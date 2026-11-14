// The zone values of an install with a domain, after their checks: each is already safe to write into a record, a route, or a rule.

import { ADMIN_LABEL, type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD, MARKER, type PublicWord, parsePublicWord } from "@poplin/core/src/names/marker";

/** The most characters a domain may hold: a site's first label and its dot take up to 64, and DNS carries 253 in a hostname. */
const MAX_DOMAIN_LENGTH = 189;

declare const layoutBrand: unique symbol;

/** The layout as the Worker's `ZONE` binding or a form holds it, unchecked. `public_word` is the word every public-name address ends in; absent, it is `page`. */
export interface RawLayout {
  readonly domain: string;
  readonly public_word?: string | undefined;
}

/** A layout made by `parseDomainLayout` alone. `adminHostname` is `poplin.<domain>`, which no site address can be. */
export interface DomainLayout {
  readonly domain: Hostname;
  readonly adminHostname: Hostname;
  readonly publicWord: PublicWord;
  readonly [layoutBrand]: true;
}

/** Why a layout was refused. `bad-domain` is also a domain too long to leave the longest site hostname room. */
type LayoutRefusal = "bad-domain" | "bad-public-word";

/** A layout, or the first rule it breaks. */
export type CheckedLayout = { readonly ok: true; readonly value: DomainLayout } | { readonly ok: false; readonly refusal: LayoutRefusal };

/**
 * Check a layout before any of it reaches Cloudflare.
 *
 * @returns the layout, or the first rule it breaks
 */
export function parseDomainLayout(raw: RawLayout): CheckedLayout {
  const domain = parseHostname(raw.domain);
  if (!domain.ok || domain.value.length > MAX_DOMAIN_LENGTH) return { ok: false, refusal: "bad-domain" };

  const publicWord = raw.public_word === undefined ? DEFAULT_PUBLIC_WORD : parsePublicWord(raw.public_word);
  if (publicWord === undefined) return { ok: false, refusal: "bad-public-word" };

  return { ok: true, value: { domain: domain.value, adminHostname: `${ADMIN_LABEL}.${domain.value}`, publicWord } as DomainLayout };
}

/**
 * Write what the hostname of every label address ends with: `-poplin`, a dot, and the domain.
 *
 * @returns the ending a Worker route takes after its leading wildcard
 */
export function siteEnding(layout: DomainLayout): string {
  return `${MARKER}.${layout.domain}`;
}
