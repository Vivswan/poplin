// The path grammar: where every site of a kind shares one hostname, the first segment of a path names the site.
//
//   /<name>--<id>/     a site, by its label
//   /<id>/             a site, by its id alone
//   /<public name>/    a public site, by its public name
//
// Only the id of a label finds the site: the name may be any name. Twelve base36 characters are always an id, so no public name has that form.

import { parseSiteId, type SiteId } from "../sites/ids";
import { type SiteLabel, siteReference } from "../sites/labels";
import type { PublicName, ReservedNames, SiteName } from "./names";

/** What stands before a segment and after it. */
const SLASH = "/";

/** The public names a path grammar keeps for itself: those in the form of an id, which a first segment always reads as one. */
export const ID_FORM_NAMES: ReservedNames = { has: (name) => parseSiteId(name).ok };

/** What a first segment names: a site by its id, with the name the segment carried, or whichever site holds a public name. The name is never checked against the site's. */
type SegmentParts = { readonly kind: "site"; readonly id: SiteId; readonly name?: SiteName } | { readonly kind: "public-name"; readonly name: PublicName };

/** A first segment's parts, and the path after it: empty when no slash follows the segment. */
type PathParts = SegmentParts & { readonly path: string };

/**
 * Write the path that names a site and nothing inside it.
 *
 * @param segment - the site's label, its id alone, or its public name
 * @returns `/<segment>`, which `readSegment` reads back with an empty path; a public name reads back as one only when `ID_FORM_NAMES` does not keep it
 */
export function segmentPath(segment: SiteLabel | SiteId | PublicName): string {
  return `${SLASH}${segment}`;
}

/**
 * Read what the first segment of a path names.
 *
 * @param pathname - a URL's path, still percent-encoded; the segment is compared as given, so capitals and an encoded character name nothing
 * @returns the segment's parts and the path after it, or `undefined` for a first segment that is no label, id, or name; no lookup is made, so a site may still not exist
 */
export function readSegment(pathname: string): PathParts | undefined {
  if (!pathname.startsWith(SLASH)) return undefined;

  const end = pathname.indexOf(SLASH, SLASH.length);
  const segment = end === -1 ? pathname.slice(SLASH.length) : pathname.slice(SLASH.length, end);
  const path = end === -1 ? "" : pathname.slice(end);

  const reference = siteReference(segment);
  if (!reference.ok) return undefined;

  if (reference.value.kind === "public-name") return { kind: "public-name", name: reference.value.name, path };

  return { kind: "site", id: reference.value.id, ...(reference.value.kind === "site" ? { name: reference.value.name } : {}), path };
}
