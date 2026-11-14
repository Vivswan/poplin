// The hostname layout: every site has a hostname of its own under the install's domain.
//
//   <name>--<id>-p-poplin.<domain>          a private site, by its label
//   <name>--<id>-u-poplin.<domain>          an unlisted or a public site, by its label
//   <public name>-<public word>.<domain>    a public site, by its public name
//   gallery-<public word>.<domain>          the gallery
//   poplin.<domain>/login                   where a login starts

import { ADMIN_LABEL, type Hostname } from "@poplin/core/src/names/hostname";
import { type AccessLetter, keptPublicNames, letterOf, MARKER, type PublicWord, publicHostLabel, readHostLabel, siteHostLabel } from "@poplin/core/src/names/marker";
import type { PublicName, SiteName } from "@poplin/core/src/names/names";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { siteLabel } from "@poplin/core/src/sites/labels";
import type { Addressed, SiteAddresses } from "./addresses";

/** The name before the public word in the gallery's hostname. */
const GALLERY_NAME = "gallery";

/** The public names of the layout's own pages: a site holding one would take the hostname of that page. */
const OWN_NAMES: ReadonlySet<string> = new Set([GALLERY_NAME]);

/** The dashboard path that starts a login. */
const LOGIN_PATH = "/login";

/** What the login refuses in a return, though a URL keeps it as written in a query. */
const BACKSLASH = "\\";

/** The backslash as a query carries it past the login. */
const ENCODED_BACKSLASH = "%5C";

/** The one answer for every URL that names nothing of the install. */
const NONE: Addressed = { kind: "none" };

/** The checked values the layout is built from. */
interface HostnameLayout {
  /** The domain every hostname of the install sits under. */
  readonly domain: Hostname;

  /** The word every public-name address ends in, chosen once at install. */
  readonly publicWord: PublicWord;
}

/**
 * Build the addresses of an install whose sites are hostnames under its domain.
 *
 * @returns the layout's answers; a site hostname is any that ends with `-poplin` or the public word, a dot, and the domain, whatever stands before
 */
export function hostnameAddresses(layout: HostnameLayout): SiteAddresses {
  const domainEnding = `.${layout.domain}`;
  const siteEndings = [`${MARKER}${domainEnding}`, `-${layout.publicWord}${domainEnding}`];
  const reserved = keptPublicNames(layout.publicWord, OWN_NAMES);
  const galleryLabel = publicHostLabel(GALLERY_NAME as PublicName, layout.publicWord);

  function resolve(url: URL): Addressed {
    if (!url.hostname.endsWith(domainEnding)) return NONE;

    const label = url.hostname.slice(0, -domainEnding.length);
    if (label === galleryLabel) return { kind: "gallery" };

    const parts = readHostLabel(label, { publicWord: layout.publicWord, reserved });
    if (parts.kind === "not-ours" || parts.kind === "not-found") return NONE;

    return { ...parts, path: url.pathname };
  }

  // The return target is the site's own address and nothing the request chose besides its path: the login decides whether to go back there.
  function loginFor(url: URL): string {
    const login = new URL(`https://${ADMIN_LABEL}${domainEnding}${LOGIN_PATH}`);
    const asked = `https://${url.hostname}${url.pathname}${url.search}`;
    login.searchParams.set("return", asked.replaceAll(BACKSLASH, ENCODED_BACKSLASH));

    return login.href;
  }

  function letterFormOf(typed: { readonly id: SiteId; readonly name?: SiteName }, letter: AccessLetter): string {
    const site = typed.name === undefined ? typed.id : siteLabel(typed.name, typed.id);

    return `https://${siteHostLabel(site, letter)}${domainEnding}`;
  }

  return {
    resolve,
    isSiteHost: (hostname) => siteEndings.some((ending) => hostname.endsWith(ending)),
    loginFor,
    // A CSP host source takes a wildcard only as its whole first label, so `*-poplin.<domain>` cannot be written: every hostname under the domain is named.
    frameAncestors: `https://*.${layout.domain}`,
    addressOf: (label, access) => `https://${siteHostLabel(label, letterOf(access))}${domainEnding}`,
    publicAddressOf: (name) => `https://${publicHostLabel(name, layout.publicWord)}${domainEnding}`,
    letterFormOf,
    reservedNames: reserved,
  };
}
