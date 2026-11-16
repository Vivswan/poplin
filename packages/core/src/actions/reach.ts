// The way into every action: the install's settings, the site a reference names, and whether the actor may touch it.

import { type Actor, mayReachSite } from "../auth/scopes";
import type { SettingsAndSite, ShownSite, Signed, SitesShown } from "../database/database";
import { parsePublicName } from "../names/names";
import type { SettingValues } from "../records/settings";
import type { Site } from "../records/site";
import { dayOf } from "../records/views";
import type { SiteId } from "../sites/ids";
import { siteReference } from "../sites/labels";
import { type Install, type Refused, refuse, settingsOf } from "./records";

/** What an action starts from: the settings, and the signature its changes carry. */
interface Entered {
  readonly ok: true;
  readonly settings: SettingValues;
  readonly signed: Signed;
}

/** What a screen shows beside one site: its views, and the note of each token that published a kept version of it. */
type Beside = Pick<ShownSite, "views" | "publishers">;

/** An install entered, with the site the action is about, and what was asked to be read beside it when that came in the same question: never for a site found by its public name. */
interface Reached extends Entered {
  readonly site: Site;
  readonly beside?: Beside;
}

/** The settings and the site a reference named, with what was read beside the site. */
interface Found extends SettingsAndSite {
  readonly beside?: Beside;
}

/** The settings and the site with an id: together in one question, with what a screen shows beside the site when asked, or the site alone for a request that brought the settings. */
async function byIdOf(install: Install, id: SiteId, shown: SitesShown | undefined): Promise<Found> {
  if (shown !== undefined) {
    const { settings, site, views, publishers } = await install.database.getShownSite(id, shown);

    return { settings: install.knownSettings ?? settings, site, ...(site === undefined ? {} : { beside: { views, publishers } }) };
  }

  if (install.knownSettings === undefined) return install.database.getSiteWithSettings(id);

  return { settings: install.knownSettings, site: await install.database.getSite(id) };
}

/** Read the settings and the site a reference names. An id, which every label holds, costs one question. */
async function findSite(install: Install, reference: string, shown: SitesShown | undefined): Promise<Found | "malformed"> {
  const parsed = siteReference(reference);
  if (!parsed.ok) return "malformed";

  const named = parsed.value;
  if (named.kind === "public-name") {
    const settings = await settingsOf(install);

    return { settings, site: settings === undefined ? undefined : await install.database.getSiteByPublicName(named.name) };
  }

  const byId = await byIdOf(install, named.id, shown);
  // A label names its site by the id alone, so the label a site had before a rename still reaches it.
  if (named.kind === "site" || byId.site !== undefined || byId.settings === undefined) return byId;

  // Twelve base36 characters are also the form of a name, so a miss as an id is tried as a public name.
  const publicName = parsePublicName(reference, install.reservedNames);
  if (!publicName.ok) return byId;

  return { settings: byId.settings, site: await install.database.getSiteByPublicName(publicName.value) };
}

/** Whether everyone may open the site at `now`, so that it exists is no secret. */
function isOpenToAll(site: Site, now: number): boolean {
  return site.access === "public" && site.state === "live" && (site.expires === "never" || site.expires > now);
}

/**
 * Enter the install for an action on no one site.
 *
 * @returns the settings and the signature of the actor at the clock's time, or `not_set_up` before setup stored the settings
 */
export async function enterInstall(install: Install, actor: Actor): Promise<Entered | Refused<"not_set_up">> {
  const settings = await settingsOf(install);
  if (settings === undefined) return refuse("not_set_up");

  return { ok: true, settings, signed: { by: actor.holder, at: install.now() } };
}

/**
 * Find the site a reference names and decide whether the actor may touch it.
 *
 * @param reference - the label `name--id`, of which the id alone is read, the bare id, or the public name of a public site
 * @param beside - read the site's views up to today, and with `publishers` who published its versions, in the same question as the site
 * @returns the site, in the trash or not. `bad_argument` for a string that is no reference, `not_found` for a reference to no site.
 * A publisher asking for another's site is answered `not_allowed` when everyone may open the site, and `not_found` otherwise, as if there were none
 */
export async function reachSite(
  install: Install,
  actor: Actor,
  reference: string,
  beside?: Pick<SitesShown, "publishers">,
): Promise<Reached | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed">> {
  const signed = { by: actor.holder, at: install.now() };
  const found = await findSite(install, reference, beside === undefined ? undefined : { day: dayOf(signed.at), publishers: beside.publishers });
  if (found === "malformed") {
    const entered = await enterInstall(install, actor);

    return entered.ok ? refuse("bad_argument", "site") : entered;
  }

  const { settings, site } = found;
  if (settings === undefined) return refuse("not_set_up");

  if (site === undefined) return refuse("not_found");

  if (mayReachSite(actor, site.owner)) return { ok: true, settings, signed, site, ...(found.beside === undefined ? {} : { beside: found.beside }) };

  return refuse(isOpenToAll(site, signed.at) ? "not_allowed" : "not_found");
}
