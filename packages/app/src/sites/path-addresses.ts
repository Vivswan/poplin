// The path layout: every site is a path on one of two hostnames, and the sites of a kind share a hostname.
//
//   <private host>/<name>--<id>/    a private site, by its label
//   <sites host>/<name>--<id>/      an unlisted or a public site, by its label
//   <sites host>/<public name>/     a public site, by its public name
//
// The hostname carries the letter: the private host is `p`, the sites host is `u`.

import type { Hostname } from "@poplin/core/src/names/hostname";
import { type AccessLetter, letterOf } from "@poplin/core/src/names/marker";
import type { SiteName } from "@poplin/core/src/names/names";
import { ID_FORM_NAMES, readSegment, segmentPath } from "@poplin/core/src/names/segment";
import type { SiteId } from "@poplin/core/src/sites/ids";
import { siteLabel } from "@poplin/core/src/sites/labels";
import type { Addressed, SiteAddresses } from "./addresses";

/** The one answer for every URL that names nothing of the install. */
const NONE: Addressed = { kind: "none" };

/** What ends the address of a site: a page's relative links resolve inside the site only after it. */
const SLASH = "/";

/** The checked values the layout is built from: two different hostnames. Given one hostname twice, every site address reads as a private one. */
interface PathLayout {
  /** The hostname every unlisted and public site answers at. */
  readonly sitesHost: Hostname;

  /** The hostname every private site answers at; the install's login stands in front of all of it. */
  readonly privateHost: Hostname;
}

/**
 * Build the addresses of an install whose sites are paths on two hostnames.
 *
 * @returns the layout's answers; a site hostname is one of the two, and no other
 */
export function pathAddresses(layout: PathLayout): SiteAddresses {
  const hosts: Readonly<Record<AccessLetter, Hostname>> = { p: layout.privateHost, u: layout.sitesHost };

  function letterAt(hostname: string): AccessLetter | undefined {
    if (hostname === layout.privateHost) return "p";

    return hostname === layout.sitesHost ? "u" : undefined;
  }

  function resolve(url: URL): Addressed {
    const letter = letterAt(url.hostname);
    if (letter === undefined) return NONE;

    const parts = readSegment(url.pathname);
    if (parts === undefined) return NONE;

    if (parts.kind === "site") return { ...parts, letter };

    // A public name is an address on the sites host alone: the private host holds labels and ids.
    return letter === "u" ? parts : NONE;
  }

  function letterFormOf(typed: { readonly id: SiteId; readonly name?: SiteName }, letter: AccessLetter): string {
    const site = typed.name === undefined ? typed.id : siteLabel(typed.name, typed.id);

    return `https://${hosts[letter]}${segmentPath(site)}`;
  }

  return {
    resolve,
    isSiteHost: (hostname) => letterAt(hostname) !== undefined,
    frameAncestors: `https://${layout.sitesHost} https://${layout.privateHost}`,
    addressOf: (label, access) => `https://${hosts[letterOf(access)]}${segmentPath(label)}${SLASH}`,
    publicAddressOf: (name) => `https://${layout.sitesHost}${segmentPath(name)}${SLASH}`,
    letterFormOf,
    reservedNames: ID_FORM_NAMES,
  };
}
