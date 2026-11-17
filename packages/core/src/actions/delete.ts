// Delete: a site into the trash, or gone for good with its files.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import type { Signed } from "../database/database";
import type { Site, SiteFolder } from "../records/site";
import type { SiteId } from "../sites/ids";
import { removeFiles, sitePrefix } from "./files";
import { reachSite } from "./reach";
import { type Install, REHEARSAL, type Refused, refuse } from "./records";
import { SITE_OBJECT, siteAnswer } from "./site-object";

/** What a delete may ask for besides its site: whether the site goes now and for good, and whether nothing is to change. */
export const DELETE_OPTIONS = v.strictObject({ no_trash: v.optional(v.boolean()), ...REHEARSAL.entries });

/** What a delete answers: the site as it was, the site in the trash or `null` once it is gone for good, and the prefix whose files are not all removed yet. */
export const DELETED_SITE = v.object({ before: v.nullable(SITE_OBJECT), site: v.nullable(SITE_OBJECT), left: v.pipe(v.array(v.string()), v.readonly()) });

/** A site removed for good, as it last was. `left` holds the site's prefix while files of it are still to be removed, and is empty once all went. */
interface Removed {
  readonly site: Site;
  readonly left: readonly string[];
}

/**
 * Remove what the bucket still holds under the folders of removed sites, as far as one bounded removal goes for each, and forget the folders that are empty, all in one query.
 *
 * @param folders - leftovers: the folders of sites that are removed, at most 100
 * @returns how many folders were emptied, and the prefix of each one files may still sit under
 * @throws {Error} the database failed; the folders stay leftovers
 */
export async function emptyLeftovers(install: Install, folders: readonly SiteFolder[]): Promise<{ readonly emptied: number; readonly left: readonly string[] }> {
  const left: string[] = [];
  const emptied: SiteFolder[] = [];

  for (const folder of folders) {
    const remaining = await removeFiles(install.store, [sitePrefix(folder)]);
    left.push(...remaining);
    if (remaining.length === 0) emptied.push(folder);
  }

  await install.database.forgetLeftovers(emptied);

  return { emptied: emptied.length, left };
}

/**
 * Remove a site for good: the row first, then the files under its folder as far as one bounded removal goes.
 *
 * In that order a crash between the two leaves files no row points to, which nothing can serve. The other order would leave a site that is served with files missing.
 * The database keeps the folder as a leftover from the moment the row goes, so the sweep removes whatever this call left.
 *
 * @returns the site as it was, or `undefined` when there is no such site
 */
async function removeSite(install: Install, id: SiteId, signed: Signed): Promise<Removed | undefined> {
  const deleted = await install.database.deleteSite(id, signed);
  if (deleted.kind !== "done") return undefined;

  return { site: deleted.site, left: (await emptyLeftovers(install, [deleted.site.folder])).left };
}

/**
 * Move a site to the trash, or remove it for good.
 *
 * @param request - `site` is a reference to the site. `no_trash` removes the row and the files now, from the trash or not; without it the site goes to the trash and keeps its public name.
 *   With `dry_run` nothing is changed and no file is removed: the answer is what the delete would come to, with `left` empty, since no file was looked for
 * @returns the site in the trash; with `no_trash`, `site` is `null` and `before` is the site as it last was. `left` names the prefix whose files are not all removed yet, which the sweep finishes; it is empty once all went
 */
export async function deleteSite(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof DELETE_OPTIONS> & { readonly site: string },
): Promise<({ readonly ok: true } & Readonly<v.InferOutput<typeof DELETED_SITE>>) | Refused<"not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "in_trash">> {
  const reached = await reachSite(install, actor, request.site);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;

  if (request.dry_run === true) {
    if (request.no_trash === true) return { ...siteAnswer({ before: site, after: site }, install, settings), site: null, left: [] };

    if (site.state === "trash") return refuse("in_trash");

    return { ...siteAnswer({ before: site, after: { ...site, state: "trash", trashed_at: signed.at } }, install, settings), left: [] };
  }

  if (request.no_trash === true) {
    const removed = await removeSite(install, site.id, signed);
    if (removed === undefined) return refuse("not_found");

    return { ...siteAnswer({ before: removed.site, after: removed.site }, install, settings), site: null, left: removed.left };
  }

  const trashed = await install.database.trashSite(site.id, signed);
  if (trashed.kind !== "done") return refuse(trashed.kind);

  return { ...siteAnswer({ before: site, after: trashed.site }, install, settings), left: [] };
}
