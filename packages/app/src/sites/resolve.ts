// From a visitor's hostname to what it addresses: a site by its label, a public name, the gallery, or nothing of this install.

import { readHostLabel } from "@poplin/core/src/names/suffix";
import type { LabelParts } from "@poplin/core/src/sites/labels";
import type { DomainLayout } from "../cloudflare/layout";

/** The public name every install keeps for its gallery page. */
const GALLERY_NAME = "gallery";

/** What a hostname addresses. `none` is every hostname that names no site: outside the domain, without the suffix, or around no valid label. */
type Addressed = LabelParts | { readonly kind: "gallery" } | { readonly kind: "none" };

/**
 * Read what a request's hostname addresses.
 *
 * @param hostname - the host of the request's URL, in lowercase and without a port
 * @returns the label's parts, the gallery, or `none`; no lookup is made, so a site may still not exist
 */
export function resolveHostname(hostname: string, zone: DomainLayout): Addressed {
  const ending = `.${zone.domain}`;
  if (!hostname.endsWith(ending)) return { kind: "none" };

  const label = hostname.slice(0, -ending.length);
  if (label === `${GALLERY_NAME}${zone.suffix}`) return { kind: "gallery" };

  const parts = readHostLabel(zone.suffix, label);
  if (parts.kind === "not-ours" || parts.kind === "not-found") return { kind: "none" };

  return parts;
}
