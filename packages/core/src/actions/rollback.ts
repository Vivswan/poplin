// Rollback: make an earlier kept version of a site the live one. No file moves.

import type { Actor } from "../auth/scopes";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/** The codes a rollback may be refused with. */
type RollbackCode = "not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "in_trash" | "no_such_version";

/**
 * Go back to a kept version of a site. Only the content changes; the settings stay.
 *
 * @param request - `site` is a reference to the site. `version` is the number to go to; without it the site goes to the highest kept version below the live one
 * @returns the site at its new live version; a `version` that is live already changes nothing. `no_such_version` when the number is not kept, or no kept version is below the live one
 */
export async function rollbackSite(
  install: Install,
  actor: Actor,
  request: { readonly site: string; readonly version?: number },
): Promise<SiteAnswer | Refused<RollbackCode>> {
  const reached = await reachSite(install, actor, request.site);
  if (!reached.ok) return reached;

  const target = request.version ?? "previous";
  if (target !== "previous" && (!Number.isSafeInteger(target) || target < 1)) return refuse("bad_argument", "version");

  const moved = await install.database.setLiveVersion(reached.site.id, target, reached.signed);
  if (moved.kind !== "done" && moved.kind !== "unchanged") return refuse(moved.kind);

  return siteAnswer({ before: reached.site, after: moved.site }, install, reached.settings);
}
