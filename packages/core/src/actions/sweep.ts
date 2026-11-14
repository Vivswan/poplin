// The sweep a scheduled job runs: expired sites go to the trash, sites whose time in the trash has passed go for good, uploads past their time go with their files, the files removed sites left behind go, and logins that ran out go last.

import * as v from "valibot";

import type { Login } from "../auth/logins";
import type { Actor } from "../auth/scopes";
import type { Signed } from "../database/database";
import { POSITIVE } from "../records/fields";
import type { Site, SiteFolder } from "../records/site";
import { SWEEP_PLACE, type SweepPlace } from "../records/sweep-place";
import type { Upload } from "../records/upload";
import { emptyLeftover, removeSite } from "./delete";
import { enterInstall } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { DAY_MS } from "./site-object";
import { removeDropped, removeUploadFiles, sweepableBefore } from "./uploads";

/** The most sites one call looks at. */
const MAX_STEP = 100;

/** Who signs the audit entry of every site a scheduled sweep moves or removes. No person logs in under a `.invalid` address. */
export const SWEEPER = { scope: "admin", holder: "sweep@poplin.invalid" as Login } as const;

/** A step that did nothing. */
const NOTHING_SWEPT = { ok: true, trashed: 0, deleted: 0, uploads: 0, emptied: 0, logins: 0, left: [] } as const;

/** What one call of the sweep may ask for. */
const STEP = v.strictObject({ limit: v.pipe(POSITIVE, v.maxValue(MAX_STEP)), from: v.optional(SWEEP_PLACE, { trash: false }) });

/**
 * What one call did. `next` is where the walk goes on, and is absent once it has looked at every site, all of the trash, every old upload, and every leftover.
 *
 * `uploads` counts the upload records removed, and `emptied` the folders of removed sites whose last files went.
 * `left` names the prefixes of removed sites and of old uploads that may still hold files; a later walk takes each up again.
 *
 * `logins` counts the logins of computers removed because they ran out, which the last step of a walk does.
 */
interface Swept {
  readonly ok: true;
  readonly trashed: number;
  readonly deleted: number;
  readonly uploads: number;
  readonly logins: number;
  readonly emptied: number;
  readonly left: readonly string[];
  readonly next?: SweepPlace;
}

/** Move the sites past their expiry to the trash, and answer how many went. */
async function trashExpired(install: Install, sites: readonly Site[], signed: Signed): Promise<number> {
  let trashed = 0;

  for (const listed of sites) {
    if (listed.expires === "never" || listed.expires > signed.at) continue;

    // Read again: the site may have been given a later expiry since the listing.
    const site = await install.database.getSite(listed.id);
    if (site === undefined || site.expires === "never" || site.expires > signed.at) continue;

    const moved = await install.database.trashSite(site.id, signed);
    if (moved.kind === "done") trashed += 1;
  }

  return trashed;
}

/** Remove for good the sites that have sat in the trash for `trashDays`. */
async function removeSatOut(
  install: Install,
  sites: readonly Site[],
  rule: { readonly trashDays: number; readonly signed: Signed },
): Promise<{ readonly deleted: number; readonly left: readonly string[] }> {
  const left: string[] = [];
  let deleted = 0;

  for (const listed of sites) {
    if (listed.state !== "trash" || listed.trashed_at + rule.trashDays * DAY_MS > rule.signed.at) continue;

    // Read again: the site may have been restored since the listing.
    const site = await install.database.getSite(listed.id);
    if (site?.state !== "trash" || site.trashed_at + rule.trashDays * DAY_MS > rule.signed.at) continue;

    const removed = await removeSite(install, site.id, rule.signed);
    if (removed === undefined) continue;

    deleted += 1;
    left.push(...removed.left);
  }

  return { deleted, left };
}

/** Remove what an old upload left in the store: the versions its publish dropped when it was made live, and its own files otherwise. */
function removeLeftovers(install: Install, upload: Upload): Promise<readonly string[]> {
  if (upload.state === "finished") return removeDropped(install, upload, upload.dropped);

  return removeUploadFiles(install, upload);
}

/** Remove the old uploads with what they left in the store. A record goes only once its files are gone, so a removal that ran out of pages is taken up by the next walk. */
async function removeOldUploads(install: Install, uploads: readonly Upload[]): Promise<{ readonly uploads: number; readonly left: readonly string[] }> {
  const left: string[] = [];
  let removed = 0;

  for (const upload of uploads) {
    // A pending upload is given up first, so nothing can finish it while its files go.
    if (upload.state === "pending" && !(await install.database.abandonUpload(upload.id))) continue;

    const remaining = await removeLeftovers(install, upload);
    left.push(...remaining);
    if (remaining.length > 0) continue;

    if (await install.database.removeUpload(upload.id)) removed += 1;
  }

  return { uploads: removed, left };
}

/** Take up the folders removed sites left behind: remove what one bounded removal reaches under each, and forget the ones that are empty. */
async function emptyLeftovers(install: Install, folders: readonly SiteFolder[]): Promise<{ readonly emptied: number; readonly left: readonly string[] }> {
  const left: string[] = [];
  let emptied = 0;

  for (const folder of folders) {
    const remaining = await emptyLeftover(install, folder);
    left.push(...remaining);
    if (remaining.length === 0) emptied += 1;
  }

  return { emptied, left };
}

/** One step over the sites or over the trash. */
async function sweepSites(install: Install, from: Extract<SweepPlace, { readonly trash: boolean }>, rule: { readonly limit: number; readonly trashDays: number; readonly signed: Signed }): Promise<Swept> {
  const page = await install.database.listSites({ trash: from.trash, limit: rule.limit, after: from.after });
  const trashed = from.trash ? 0 : await trashExpired(install, page.sites, rule.signed);
  const { deleted, left } = from.trash ? await removeSatOut(install, page.sites, rule) : { deleted: 0, left: [] };

  const done = { ...NOTHING_SWEPT, trashed, deleted, left };
  if (page.next !== undefined) return { ...done, next: { trash: from.trash, after: page.next } };

  if (!from.trash) return { ...done, next: { trash: true } };

  return { ...done, next: { uploads: true } };
}

/** One step over the old uploads. */
async function sweepUploads(install: Install, from: Extract<SweepPlace, { readonly uploads: true }>, rule: { readonly limit: number; readonly signed: Signed }): Promise<Swept> {
  const old = await install.database.listUploads({ before: sweepableBefore(rule.signed.at), limit: rule.limit, after: from.after });
  const removed = await removeOldUploads(install, old.uploads);

  return { ...NOTHING_SWEPT, ...removed, next: old.next === undefined ? { leftovers: true } : { uploads: true, after: old.next } };
}

/** One step over the leftovers. The one that has looked at the last of them ends the walk by removing the logins that ran out. */
async function sweepLeftovers(install: Install, from: Extract<SweepPlace, { readonly leftovers: true }>, rule: { readonly limit: number; readonly signed: Signed }): Promise<Swept> {
  const page = await install.database.listLeftovers({ limit: rule.limit, after: from.after });
  const swept = { ...NOTHING_SWEPT, ...(await emptyLeftovers(install, page.folders)) };
  if (page.next !== undefined) return { ...swept, next: { leftovers: true, after: page.next } };

  return { ...swept, logins: await install.database.sweepComputerLogins(rule.signed.at) };
}

/**
 * Take one step of the walk that moves every site past its expiry to the trash, removes for good every site that has sat in the trash for `trash_days`, and removes every upload begun over 25 hours ago.
 * The walk ends by removing the files removed sites left behind, then every login of a computer that ran out.
 *
 * One step lists once and looks at up to `limit` sites, uploads, or leftovers, so its cost is bounded: one read and one change per site that is due, none for a site that is not, and one bounded file removal per item.
 * @param actor - an admin, who signs the audit entry of every site moved or removed
 * @param step - `limit` is 1 to 100; `from` is the `next` of the step before, and absent to start a walk
 * @returns what the step did, `not_allowed` for anyone but an admin, or `bad_argument` naming the key that was refused
 * @throws {Error} the database failed; the sites moved or removed before it stay so, each with its audit entry, and the next walk does the rest
 */
export async function sweepExpired(
  install: Install,
  actor: Actor,
  step: v.InferInput<typeof STEP>,
): Promise<Swept | Refused<"not_allowed" | "not_set_up" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(STEP, step);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "step");

  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const { settings, signed } = entered;
  const { limit, from } = asked.output;

  if ("leftovers" in from) return sweepLeftovers(install, from, { limit, signed });

  if ("uploads" in from) return sweepUploads(install, from, { limit, signed });

  return sweepSites(install, from, { limit, trashDays: settings.trash_days, signed });
}
