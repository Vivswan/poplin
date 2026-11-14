// The way into every action: the install's settings, the site a reference names, and whether the actor may touch it.

import { type Actor, mayReachSite } from "../auth/scopes";
import type { Signed } from "../database/database";
import { parsePublicName } from "../names/names";
import type { SettingValues } from "../records/settings";
import type { Site } from "../records/site";
import { siteReference } from "../sites/labels";
import { type Install, type Refused, refuse } from "./records";

/** What an action starts from: the settings, and the signature its changes carry. */
interface Entered {
  readonly ok: true;
  readonly settings: SettingValues;
  readonly signed: Signed;
}

/** An install entered, with the site the action is about. */
interface Reached extends Entered {
  readonly site: Site;
}

async function findSite(install: Install, reference: string): Promise<Site | undefined | "malformed"> {
  const parsed = siteReference(reference);
  if (!parsed.ok) return "malformed";

  const named = parsed.value;
  if (named.kind === "public-name") return install.database.getSiteByPublicName(named.name);

  const byId = await install.database.getSite(named.id);
  if (named.kind === "site") return byId?.name === named.name ? byId : undefined;

  if (byId !== undefined) return byId;

  // Twelve base36 characters are also the form of a name, so a miss as an id is tried as a public name.
  const publicName = parsePublicName(reference, install.reservedNames);
  if (!publicName.ok) return undefined;

  return install.database.getSiteByPublicName(publicName.value);
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
  const settings = await install.database.readSettings();
  if (settings === undefined) return refuse("not_set_up");

  return { ok: true, settings, signed: { by: actor.holder, at: install.now() } };
}

/**
 * Find the site a reference names and decide whether the actor may touch it.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 * @returns the site, in the trash or not. `bad_argument` for a string that is no reference, `not_found` for a reference to no site.
 * A publisher asking for another's site is answered `not_allowed` when everyone may open the site, and `not_found` otherwise, as if there were none
 */
export async function reachSite(install: Install, actor: Actor, reference: string): Promise<Reached | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed">> {
  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const site = await findSite(install, reference);
  if (site === "malformed") return refuse("bad_argument", "site");

  if (site === undefined) return refuse("not_found");

  if (mayReachSite(actor, site.owner)) return { ...entered, site };

  return refuse(isOpenToAll(site, entered.signed.at) ? "not_allowed" : "not_found");
}
