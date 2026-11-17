// Restore: take a site back out of the trash.

import type { Actor } from "../../auth/scopes";
import { reachSite } from "../access/reach";
import type { Site } from "../../records/site";
import { type Install, type Refused, type Rehearsal, refuse } from "../records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/** The site a restore at `at` would bring back, by the rule the database restores by, with nothing written; `undefined` for a site that is not in the trash. */
function rehearsedRestore(site: Site, at: number): Site | undefined {
  if (site.state !== "trash") return undefined;

  const { trashed_at: since, ...rest } = site;

  return { ...rest, state: "live", expires: site.expires !== "never" && site.expires > at ? site.expires : "never" };
}

/**
 * Take a site out of the trash. It is as it was when it went in, its public name included.
 *
 * An expiry that passed is cleared: the site's `expires` is `"never"`, since a site past its expiry is served to nobody and no setting changes in the trash. An expiry still ahead stays.
 *
 * @param reference - the label `name--id`, the bare id, or the public name of a public site
 * @param how - with `dry_run` nothing is changed, and the answer is the site as a restore would bring it back
 */
export async function restoreSite(
  install: Install,
  actor: Actor,
  reference: string,
  how: Rehearsal = {},
): Promise<SiteAnswer | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "not_in_trash">> {
  const reached = await reachSite(install, actor, reference);
  if (!reached.ok) return reached;

  if (how.dry_run === true) {
    const back = rehearsedRestore(reached.site, reached.signed.at);

    return back === undefined ? refuse("not_in_trash") : siteAnswer({ before: reached.site, after: back }, install, reached.settings);
  }

  const restored = await install.database.restoreSite(reached.site.id, reached.signed);
  if (restored.kind !== "done") return refuse(restored.kind);

  return siteAnswer({ before: reached.site, after: restored.site }, install, reached.settings);
}
