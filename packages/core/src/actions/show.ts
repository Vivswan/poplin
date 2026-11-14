// Show: one site, as its owner or an admin sees it.

import type { Actor } from "../auth/scopes";
import { reachSite } from "./reach";
import type { Install, Refused } from "./records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/**
 * Read one site, in the trash or not. Nothing changes, so `before` and `site` are the same.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 */
export async function getSite(install: Install, actor: Actor, reference: string): Promise<SiteAnswer | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed">> {
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  return siteAnswer({ before: reached.site, after: reached.site }, install, reached.settings);
}
