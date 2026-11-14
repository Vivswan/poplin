// Restore: take a site back out of the trash.

import type { Actor } from "../auth/scopes";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/**
 * Take a site out of the trash. It is as it was when it went in, its public name included.
 *
 * An expiry that passed is cleared: the site's `expires` is `"never"`, since a site past its expiry is served to nobody and no setting changes in the trash. An expiry still ahead stays.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 */
export async function restoreSite(
  install: Install,
  actor: Actor,
  reference: string,
): Promise<SiteAnswer | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "not_in_trash">> {
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  const restored = await install.database.restoreSite(reached.site.id, reached.signed);
  if (restored.kind !== "done") return refuse(restored.kind);

  return siteAnswer({ before: reached.site, after: restored.site }, install, reached.settings);
}
