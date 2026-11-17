// What the parser read, put into the forms the API takes.

import type { SiteChanges } from "../../../../core/src/actions/sites/changes";
import { siteLabel } from "../../../../core/src/sites/labels";
import { mayBeOfInstall, type SettledSite, settleSite, type TypedSite } from "../../../../core/src/sites/references";
import { type Problem, problem, problemOf } from "../problems";
import type { Session } from "../records";
import type { SiteSettings } from "./site-settings";

/** The word the API takes for a site: the label, the bare id, or the public name, as it was typed. */
export function siteWord(site: SettledSite): string {
  if (site.kind === "site") return siteLabel(site.name, site.id);

  if (site.kind === "id") return site.id;

  return site.name;
}

/**
 * Read a typed site as the install of a session reads it, before anything about the site is sent.
 *
 * A public site's address and an address with a path are placed by the layout of their install, so the install is asked for its layout: one call, and only for such an address.
 *
 * @param site - the site a command names, as it was typed
 * @returns the site. `not_found` for an address under another domain or port than the install's sites, and for one that is no site's under the install's layout; else why the install did not answer
 */
export async function readByInstall(site: TypedSite, session: Pick<Session, "layout" | "server">): Promise<SettledSite | Problem> {
  if (!mayBeOfInstall(site, session.server)) return problem("not_found", `the URL is under ${site.under}, which ${session.server} does not serve sites on`);

  if (site.kind !== "address") return site;

  const answered = await session.layout();
  if (!answered.ok) return problemOf(answered.failure);

  // Under hostnames a site is named by its hostname alone, so a path is no part of what the refusal names.
  const named = answered.value.kind === "path" && site.segment !== undefined ? `/${siteWord(site.segment)}` : "";

  return settleSite(site, { server: session.server, layout: answered.value }) ?? problem("not_found", `${site.label}.${site.under}${named} is not a site URL of ${session.server}`);
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
