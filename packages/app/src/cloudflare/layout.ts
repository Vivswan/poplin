// A zone layout that passed its checks: the hostnames an install with a domain answers on, each already safe to write into a record, a route, or a rule.

import { type Hostname, isUnder, parseHostname } from "./hostname";

// A label holds 63 characters; a secret address takes up to 54: a 40 character name, two dashes, a 12 character secret.
const MAX_PREFIX_LENGTH = 9;

// The start of a hostname label, or nothing: no dot, quote, or capital.
const PREFIX = /^(?:[a-z0-9][a-z0-9-]*)?$/;

declare const layoutBrand: unique symbol;

/** The layouts an install with a domain can use, by their `names` setting. */
type LayoutNames = "domain" | "subdomain-per-site" | "subdomain-wildcard";

/**
 * The layout as settings or a form hold it, unchecked.
 *
 * `pagesHostname` is absent when the gallery is off and is the domain itself when the gallery sits on the bare domain. `prefix` is read by the `domain` layout alone.
 */
export interface RawLayout {
  readonly names: LayoutNames;
  readonly domain: string;
  readonly adminHostname: string;
  readonly pagesHostname: string | undefined;
  readonly prefix: string;
}

interface PrefixedLayout {
  readonly names: "domain";
  readonly domain: Hostname;
  readonly adminHostname: Hostname;
  readonly pagesHostname: Hostname | undefined;
  readonly prefix: string;
}

interface SubdomainLayout {
  readonly names: "subdomain-per-site" | "subdomain-wildcard";
  readonly domain: Hostname;
  readonly adminHostname: Hostname;
  readonly pagesHostname: Hostname;
}

/** A layout made by `parseDomainLayout` alone: every hostname is the domain or under it, and the admin hostname is no site address. */
export type DomainLayout = (PrefixedLayout | SubdomainLayout) & { readonly [layoutBrand]: true };

/** Why a layout was refused. */
type LayoutRefusal =
  | "bad-domain"
  | "bad-admin-hostname"
  | "bad-pages-hostname"
  | "bad-prefix"
  | "admin-outside-domain"
  | "pages-outside-domain"
  | "admin-is-pages"
  | "admin-under-pages"
  | "pages-required";

/** A layout, or the first rule it breaks. */
export type CheckedLayout = { readonly ok: true; readonly value: DomainLayout } | Refused;

interface Refused {
  readonly ok: false;
  readonly refusal: LayoutRefusal;
}

function refuse(refusal: LayoutRefusal): Refused {
  return { ok: false, refusal };
}

function parsePages(raw: string | undefined, domain: Hostname, admin: Hostname): { readonly ok: true; readonly value: Hostname | undefined } | Refused {
  if (raw === undefined) return { ok: true, value: undefined };

  const pages = parseHostname(raw);
  if (!pages.ok) return refuse("bad-pages-hostname");

  if (pages.value !== domain && !isUnder(pages.value, domain)) return refuse("pages-outside-domain");

  if (pages.value === admin) return refuse("admin-is-pages");

  return pages;
}

/**
 * Check a layout before any of it reaches Cloudflare.
 *
 * @returns the layout, or the first rule it breaks; a subdomain layout drops the prefix
 */
export function parseDomainLayout(raw: RawLayout): CheckedLayout {
  const domain = parseHostname(raw.domain);
  if (!domain.ok) return refuse("bad-domain");

  const admin = parseHostname(raw.adminHostname);
  if (!admin.ok) return refuse("bad-admin-hostname");

  if (!isUnder(admin.value, domain.value)) return refuse("admin-outside-domain");

  const pages = parsePages(raw.pagesHostname, domain.value, admin.value);
  if (!pages.ok) return pages;

  const pagesHostname = pages.value;

  if (raw.names === "domain") {
    if (raw.prefix.length > MAX_PREFIX_LENGTH || !PREFIX.test(raw.prefix)) return refuse("bad-prefix");

    const layout: PrefixedLayout = { names: raw.names, domain: domain.value, adminHostname: admin.value, pagesHostname, prefix: raw.prefix };

    return { ok: true, value: layout as DomainLayout };
  }

  if (pagesHostname === undefined) return refuse("pages-required");

  // Under a subdomain layout every name below the pages hostname is a site.
  if (isUnder(admin.value, pagesHostname)) return refuse("admin-under-pages");

  const layout: SubdomainLayout = { names: raw.names, domain: domain.value, adminHostname: admin.value, pagesHostname };

  return { ok: true, value: layout as DomainLayout };
}

/**
 * List the exact hostnames the Worker answers on besides the sites.
 *
 * @returns the admin hostname, then the pages hostname when the layout has one
 */
export function ownHostnames(layout: DomainLayout): Hostname[] {
  if (layout.pagesHostname === undefined) return [layout.adminHostname];

  return [layout.adminHostname, layout.pagesHostname];
}

/**
 * Name the hostname every site sits directly under.
 *
 * @returns the domain under the `domain` layout, the pages hostname under a subdomain layout
 */
export function siteParent(layout: DomainLayout): Hostname {
  if (layout.names === "domain") return layout.domain;

  return layout.pagesHostname;
}
