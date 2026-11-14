// Set: change who may open a site, and its title, search-engines flag, embeddable flag, or expiry.

import type { Actor } from "../auth/scopes";
import { applyChanges, asksNothing, readChanges, type SiteChanges } from "./changes";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/** The codes a change of settings may be refused with. */
type SetCode = "not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "in_trash" | "bad_name" | "reserved_name" | "name_taken";

/**
 * Change the settings of a site. A setting left out stays as it is.
 *
 * Going public claims the public name, the site's own name unless `public_name` gives another; leaving public frees it.
 *
 * @param request - `site` is a reference to the site; the rest are the settings to change, at least one
 * @returns the site after the change, or a refusal: `name_taken` when another site holds the public name, `bad_argument` when nothing is asked
 */
export async function updateSite(install: Install, actor: Actor, request: SiteChanges & { readonly site: string }): Promise<SiteAnswer | Refused<SetCode>> {
  const { site: reference, ...asked } = request;
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;
  if (site.state === "trash") return refuse("in_trash");

  const changes = readChanges(asked, { name: site.name, now: signed.at });
  if (!changes.ok) return changes;

  if (asksNothing(changes)) return refuse("bad_argument", "settings");

  const applied = await applyChanges(install.database, site.id, changes, signed);
  if (!applied.ok) return applied;

  return siteAnswer({ before: site, after: applied.site }, install, settings);
}
