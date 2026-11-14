// Show: one site, as its owner or an admin sees it.

import type { Actor } from "../auth/scopes";
import { dayOf } from "../records/views";
import { reachSite } from "./reach";
import type { Install, Refused } from "./records";
import { type SiteAnswer, siteObject } from "./site-object";

/**
 * Read one site, in the trash or not, with about how often its pages were opened. Nothing changes, so `before` and `site` are the same.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 */
export async function getSite(install: Install, actor: Actor, reference: string): Promise<SiteAnswer | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed">> {
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;
  const views = (await install.database.readViews([site.id], dayOf(signed.at))).get(site.id) ?? null;
  const shown = siteObject(site, install, settings.trash_days, views);

  return { ok: true, before: shown, site: shown };
}
