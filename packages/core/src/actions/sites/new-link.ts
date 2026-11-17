// New link: a new id for a site, so a new address. The old id names no site from that moment.

import type { Actor } from "../../auth/scopes";
import { reachSite } from "../access/reach";
import { type Install, type Refused, type Rehearsal, refuse } from "../records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/**
 * Give a site a new id. Its public name, its files, and its settings stay with it.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 * @param how - with `dry_run` no id is drawn and nothing is changed
 * @returns the site under its new id and label; in a dry run the site as it is, since its new id is drawn only when it is given
 */
export async function newLink(
  install: Install,
  actor: Actor,
  reference: string,
  how: Rehearsal = {},
): Promise<SiteAnswer | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "in_trash">> {
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  const { site } = reached;
  if (how.dry_run === true) return site.state === "trash" ? refuse("in_trash") : siteAnswer({ before: site, after: site }, install, reached.settings);

  const renamed = await install.database.giveNewId(site.id, reached.signed);
  if (renamed.kind !== "done") return refuse(renamed.kind);

  return siteAnswer({ before: site, after: renamed.site }, install, reached.settings);
}
