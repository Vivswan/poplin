// What serving, the login, and the site actions ask of an install's address layout. None of them knows a hostname form or a path form.

import type { AccessLetter, HostParts } from "@poplin/core/src/names/marker";
import type { PublicName, ReservedNames, SiteName } from "@poplin/core/src/names/names";
import type { Site } from "@poplin/core/src/records/site";
import type { SiteId } from "@poplin/core/src/sites/ids";
import type { SiteLabel } from "@poplin/core/src/sites/labels";

/**
 * What a request's URL addresses. `path` is the file's path inside the site, still percent-encoded, and empty for a URL that ends right after what names the site; `none` is every URL that names nothing of this install.
 *
 * A `site` is named by its id alone: `name` and `letter` are what the URL carried, and either may be absent.
 */
export type Addressed = (HostParts & { readonly path: string }) | { readonly kind: "none" };

/** One install's address layout, as the product sees it. */
export interface SiteAddresses {
  /** Reads what a request's URL addresses; no lookup is made, so a site may still not exist. Only the host and the path are read, never the scheme or the port. */
  readonly resolve: (url: URL) => Addressed;

  /** Decides whether a hostname, in lowercase and without a port, is where a site of the install answers. */
  readonly isSiteHost: (hostname: string) => boolean;

  /** The `frame-ancestors` source that covers every page of the install's sites. */
  readonly frameAncestors: string;

  /** Writes the address a site answers at under its label, with the letter of the access given: one `resolve` reads back as that site and letter. */
  readonly addressOf: (label: SiteLabel, access: Site["access"]) => string;

  /** Writes the address a public site answers at under its public name: one `resolve` reads back as that name. */
  readonly publicAddressOf: (name: PublicName) => string;

  /** Writes the address that names a site exactly as a request did, with or without a name, under the letter given. Nothing follows what names the site, so a request's `path` is written straight after it. */
  readonly letterFormOf: (typed: { readonly id: SiteId; readonly name?: SiteName }, letter: AccessLetter) => string;

  /** The public names the layout keeps for itself: no site may hold one. */
  readonly reservedNames: ReservedNames;
}
