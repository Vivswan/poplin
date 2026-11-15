// What the parser read, put into the forms the API takes.

import type { SiteChanges } from "../../../core/src/actions/changes";
import { WHOAMI_ANSWER } from "../../../core/src/actions/manage-tokens";
import { siteLabel } from "../../../core/src/sites/labels";
import { isOfInstall, type SettledSite, settleSite, type TypedSite } from "../../../core/src/sites/references";
import { type Problem, problem, problemOf } from "./problems";
import type { Session } from "./records";
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
 * An address of the form of a public site's ends in a word its install chose, so the install is asked for the word: one call, and only for such an address.
 *
 * @param site - the site a command names, as it was typed
 * @returns the site. `not_found` for an address under another domain or port than the install's sites, and for one that is no site's under the install's word; else why the install did not answer
 */
export async function readByInstall(site: TypedSite, session: Pick<Session, "client" | "server">): Promise<SettledSite | Problem> {
  if (!isOfInstall(site, session.server)) return problem("not_found", `the address is under ${site.under}, which is not where ${session.server} keeps its sites`);

  if (site.kind !== "address") return site;

  const answered = await session.client.call(WHOAMI_ANSWER, (api) => api.whoami.$get());
  if (!answered.ok) return problemOf(answered.failure);

  return settleSite(site, answered.value.public_word) ?? problem("not_found", `${site.label}.${site.under} is not the address of a site of ${session.server}`);
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
