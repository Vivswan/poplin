// New link: a new id for a site, so a new address. The old id names no site from that moment.

import type { Actor } from "../auth/scopes";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/**
 * Give a site a new id. Its public name, its files, and its settings stay with it.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 * @returns the site under its new id and label
 */
export async function newLink(
  install: Install,
  actor: Actor,
  reference: string,
): Promise<SiteAnswer | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "in_trash">> {
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  const renamed = await install.database.giveNewId(reached.site.id, reached.signed);
  if (renamed.kind !== "done") return refuse(renamed.kind);

  return siteAnswer({ before: reached.site, after: renamed.site }, install, reached.settings);
}
