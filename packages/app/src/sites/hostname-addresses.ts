// The hostname layout: every site has a hostname of its own under the install's domain.
//
//   <name>--<id><suffix>.<domain>     a site, by its label
//   <public name><suffix>.<domain>    a public site, by its public name
//   gallery<suffix>.<domain>          the gallery
//   <admin hostname>/login            where a login starts

import type { Hostname } from "@poplin/core/src/names/hostname";
import { readHostLabel, type Suffix } from "@poplin/core/src/names/suffix";
import type { Addressed, SiteAddresses } from "./addresses";

/** The name before the suffix in the gallery's hostname. */
const GALLERY_NAME = "gallery";

/** The public names this layout keeps for itself: a site holding one would take the hostname of the install's own page. */
export const HOSTNAME_RESERVED_NAMES: ReadonlySet<string> = new Set([GALLERY_NAME]);

/** The dashboard path that starts a login. */
const LOGIN_PATH = "/login";

/** The one answer for every URL that names nothing of the install. */
const NONE: Addressed = { kind: "none" };

/** The checked values the layout is built from: the admin hostname is under the domain and is no site address. */
interface HostnameLayout {
  readonly domain: Hostname;
  readonly adminHostname: Hostname;
  readonly suffix: Suffix;
}

/**
 * Build the addresses of an install whose sites are hostnames under its domain.
 *
 * @returns the layout's answers; a site hostname is any that ends with the suffix, a dot, and the domain, whatever stands before
 */
export function hostnameAddresses(layout: HostnameLayout): SiteAddresses {
  const domainEnding = `.${layout.domain}`;
  const siteEnding = `${layout.suffix}${domainEnding}`;

  function resolve(url: URL): Addressed {
    if (!url.hostname.endsWith(domainEnding)) return NONE;

    const label = url.hostname.slice(0, -domainEnding.length);
    if (label === `${GALLERY_NAME}${layout.suffix}`) return { kind: "gallery" };

    const parts = readHostLabel(layout.suffix, label, HOSTNAME_RESERVED_NAMES);
    if (parts.kind === "not-ours" || parts.kind === "not-found") return NONE;

    return { ...parts, path: url.pathname };
  }

  // The return target is the site's own address and nothing the request chose besides its path: the login decides whether to go back there.
  function loginFor(url: URL): string {
    const login = new URL(`https://${layout.adminHostname}${LOGIN_PATH}`);
    login.searchParams.set("return", `https://${url.hostname}${url.pathname}${url.search}`);

    return login.href;
  }

  return {
    resolve,
    isSiteHost: (hostname) => hostname.endsWith(siteEnding),
    loginFor,
    // A CSP host source takes a wildcard only as its whole first label, so `*<suffix>.<domain>` cannot be written: every hostname under the domain is named.
    frameAncestors: `https://*.${layout.domain}`,
  };
}
