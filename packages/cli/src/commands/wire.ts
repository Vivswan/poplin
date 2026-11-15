// What the parser read, put into the forms the API takes.

import type { SiteChanges } from "../../../core/src/actions/changes";
import { siteLabel } from "../../../core/src/sites/labels";
import type { Request } from "./requests";
import type { SiteSettings } from "./site-settings";

/** What names a site on a command line, as the parser read it. */
type SiteRef = Extract<Request, { readonly site: unknown }>["site"];

/** The word the API takes for a site: the label, the bare id, or the public name, as it was typed. */
export function siteWord(site: SiteRef): string {
  if (site.kind === "site") return siteLabel(site.name, site.id);

  if (site.kind === "id") return site.id;

  return site.name;
}

/**
 * Put the settings a command line gave into the API's form.
 *
 * @returns the keys that were given and no other, so a setting that was not typed changes nothing
 */
export function siteChanges(settings: SiteSettings): SiteChanges {
  const changes: { -readonly [Key in keyof SiteChanges]: SiteChanges[Key] } = {};

  if (settings.name !== undefined) changes.name = settings.name;

  if (settings.access !== undefined) changes.access = settings.access;

  if (settings.publicName !== undefined) changes.public_name = settings.publicName;

  if (settings.title !== undefined) changes.title = settings.title;

  if (settings.searchEngines !== undefined) changes.search_engines = settings.searchEngines;

  if (settings.embeddable !== undefined) changes.embeddable = settings.embeddable;

  if (settings.expires?.kind === "never") changes.expires = "never";

  if (settings.expires?.kind === "date") changes.expires = settings.expires.date;

  if (settings.expires?.kind === "span") changes.expires = `${settings.expires.span.count}${settings.expires.span.unit}`;

  return changes;
}
