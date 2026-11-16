// The zone values of an install with a domain, after their checks: each is already safe to write into a record, a route, or a rule.

import { ADMIN_LABEL, type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { DEFAULT_PUBLIC_WORD, MARKER, type PublicWord, parsePublicWord } from "@poplin/core/src/names/marker";
import { INSTALL_OBJECTS } from "./install-objects";

/** The most characters Access takes in the address of an application, on an install of either kind. */
export const MAX_ACCESS_ADDRESS = 63;

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

/** Why a layout was refused. `domain-too-long` is a domain under which an open path of the dashboard or the private sites' pattern passes what Access takes. */
type LayoutRefusal = "bad-domain" | "domain-too-long" | "bad-public-word";

/** A layout, or the first rule it breaks. */
export type CheckedLayout = { readonly ok: true; readonly value: DomainLayout } | { readonly ok: false; readonly refusal: LayoutRefusal };

/**
 * Check a layout before any of it reaches Cloudflare.
 *
 * @returns the layout, or the first rule it breaks
 */
export function parseDomainLayout(raw: RawLayout): CheckedLayout {
  const domain = parseHostname(raw.domain);
  if (!domain.ok) return { ok: false, refusal: "bad-domain" };

  const addresses = [...INSTALL_OBJECTS.openPaths.map((path) => `${ADMIN_LABEL}.${domain.value}${path}`), `${INSTALL_OBJECTS.privateSitesStart}${domain.value}`];
  if (addresses.some((address) => address.length > MAX_ACCESS_ADDRESS)) return { ok: false, refusal: "domain-too-long" };

  const publicWord = raw.public_word === undefined ? DEFAULT_PUBLIC_WORD : parsePublicWord(raw.public_word);
  if (publicWord === undefined) return { ok: false, refusal: "bad-public-word" };

  return { ok: true, value: { domain: domain.value, adminHostname: `${ADMIN_LABEL}.${domain.value}`, publicWord } as DomainLayout };
}

/**
 * Write what the hostname of every site address ends with: `-poplin`, a dot, and the domain, and the same with the public word in place of `poplin`.
 *
 * @returns the endings a Worker route takes after its leading wildcard: one when the public word is `poplin`, else the label addresses' and then the public names'
 */
export function siteEndings(layout: DomainLayout): readonly string[] {
  const endings = [`${MARKER}.${layout.domain}`, `-${layout.publicWord}.${layout.domain}`];

  return [...new Set(endings)];
}

/**
 * Write the hostname pattern of every private site's address, as an Access application takes it.
 *
 * @returns `*-p-poplin.<domain>`, which fits what Access takes for every layout `parseDomainLayout` made
 */
export function privateSitesPattern(layout: DomainLayout): string {
  return `${INSTALL_OBJECTS.privateSitesStart}${layout.domain}`;
}
