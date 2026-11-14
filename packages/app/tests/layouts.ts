// The layouts and hostnames the planner tests share, each checked the way setup checks one.

import { type Hostname, parseHostname } from "../src/cloudflare/hostname";
import { type DomainLayout, parseDomainLayout, type RawLayout } from "../src/cloudflare/layout";

const BASE: RawLayout = { names: "domain", domain: "example.com", adminHostname: "admin.example.com", pagesHostname: "pages.example.com", prefix: "page-" };

/** Check a layout that a test wrote by hand; a refusal is a mistake in the test. */
function layoutOf(changes: Partial<RawLayout>): DomainLayout {
  const layout = parseDomainLayout({ ...BASE, ...changes });
  if (!layout.ok) throw new Error(`the test's layout was refused: ${layout.refusal}`);

  return layout.value;
}

/** Check a hostname that a test wrote by hand; a refusal is a mistake in the test. */
export function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the test's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

/** The default layout: sites are `page-<name>.example.com`, with a gallery. */
export const PREFIXED = layoutOf({});

/** The default layout with the gallery off. */
export const NO_GALLERY = layoutOf({ pagesHostname: undefined });

/** The default layout with the gallery on the bare domain. */
export const BARE_GALLERY = layoutOf({ pagesHostname: "example.com" });

/** A domain given over to sites: no prefix. */
export const NO_PREFIX = layoutOf({ prefix: "" });

/** Sites under the pages hostname, a certificate each. */
export const PER_SITE = layoutOf({ names: "subdomain-per-site" });

/** Sites under the pages hostname, one bought wildcard certificate. */
export const WILDCARD = layoutOf({ names: "subdomain-wildcard" });
