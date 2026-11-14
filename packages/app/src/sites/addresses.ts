// What serving and the login ask of an install's address layout. A layout answers these four; neither knows a hostname form or a path form.

import type { LabelParts } from "@poplin/core/src/sites/labels";

/** What a request's URL addresses. `path` is the file's path inside the site, still percent-encoded; `none` is every URL that names nothing of this install. */
export type Addressed = (LabelParts & { readonly path: string }) | { readonly kind: "gallery" } | { readonly kind: "none" };

/** One install's address layout, as the product sees it. */
export interface SiteAddresses {
  /** Reads what a request's URL addresses; no lookup is made, so a site may still not exist. Only the host and the path are read, never the scheme or the port. */
  readonly resolve: (url: URL) => Addressed;

  /** Decides whether a hostname, in lowercase and without a port, is where a site of the install or its gallery answers. */
  readonly isSiteHost: (hostname: string) => boolean;

  /** Writes the address that starts a login and names the request's own address as the place to return to. */
  readonly loginFor: (url: URL) => string;

  /** The `frame-ancestors` source that covers every page of the install's sites. */
  readonly frameAncestors: string;
}
