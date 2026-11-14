// Delete: a site into the trash, or gone for good with its files.

import type { Actor } from "../auth/scopes";
import type { Signed } from "../database/database";
import type { Site } from "../records/site";
import type { SiteId } from "../sites/ids";
import { removeFiles, sitePrefix } from "./files";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type SiteAnswer, type SiteObject, siteAnswer } from "./site-object";

/** A site removed for good, as it last was. `left` holds the site's prefix when its files could not all be removed, and is empty otherwise. */
interface Removed {
  readonly site: Site;
  readonly left: readonly string[];
}

/**
 * Remove a site for good: the row first, then every file under its folder.
 *
 * In that order a crash between the two leaves files no row points to, which nothing can serve. The other order would leave a site that is served with files missing.
 *
 * @returns the site as it was, or `undefined` when there is no such site
 */
export async function removeSite(install: Install, id: SiteId, signed: Signed): Promise<Removed | undefined> {
  const deleted = await install.database.deleteSite(id, signed);
  if (deleted.kind !== "done") return undefined;

  return { site: deleted.site, left: await removeFiles(install.store, [sitePrefix(deleted.site.folder)]) };
}

/**
 * Move a site to the trash, or remove it for good.
 *
 * @param request - `site` is a reference to the site. `forever` removes the row and the files now, from the trash or not; without it the site goes to the trash and keeps its public name
 * @returns the site in the trash; with `forever`, `site` is `null` and `before` is the site as it last was. `left` names the prefix whose files could not all be removed, and is empty otherwise
 */
export async function deleteSite(
  install: Install,
  actor: Actor,
  request: { readonly site: string; readonly forever?: boolean },
): Promise<(Omit<SiteAnswer, "site"> & { readonly site: SiteObject | null; readonly left: readonly string[] }) | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "in_trash">> {
  const reached = await reachSite(install, actor, request.site);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;

  if (request.forever === true) {
    const removed = await removeSite(install, site.id, signed);
    if (removed === undefined) return refuse("not_found");

    return { ...siteAnswer({ before: removed.site, after: removed.site }, install, settings), site: null, left: removed.left };
  }

  const trashed = await install.database.trashSite(site.id, signed);
  if (trashed.kind !== "done") return refuse(trashed.kind);

  return { ...siteAnswer({ before: site, after: trashed.site }, install, settings), left: [] };
}
