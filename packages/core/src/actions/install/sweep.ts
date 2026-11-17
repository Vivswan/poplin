// The sweep a scheduled job runs: expired sites go to the trash, sites whose time in the trash has passed go for good, uploads past their time go with their files, and the files removed sites left behind go.
// What ran out goes last: the logins of computers, the problems noted over 30 days ago, and the audit entries and ended tokens of over 90 days ago.

import * as v from "valibot";

import type { Actor } from "../../auth/scopes";
import type { Signed } from "../../database/database";
import { POSITIVE } from "../../records/fields";
import { SWEEP_PLACE, type SweepPlace } from "../../records/sweep-place";
import type { Upload } from "../../records/upload";
import type { SiteId } from "../../sites/ids";
import { emptyLeftovers } from "../sites/delete";
import { noteProblem } from "./problems";
import { enterInstall } from "../access/reach";
import { type Install, type Refused, refuse } from "../records";
import { DAY_MS } from "../sites/site-object";
import { removeDropped, removeUploadFiles, sweepableBefore } from "../publish/uploads";

/** The most sites one call looks at. */
const MAX_STEP = 100;

/** How many listings of the store a day the scheduled sweep may make beyond `max_storage_writes_per_day`: whatever else used the day up, it still empties a thousand folders, or removes a million files. */
export const SWEEP_SPARE_WRITES = 1000;

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

/**
 * Remove for good the sites that went to the trash at `trashedBy` or before, the rows first and all in one query, then the files under each folder as far as one bounded removal goes.
 * One restored since it was listed stays: the removal itself checks. The database keeps each folder as a leftover from the moment its row goes, so a later walk removes whatever this call left.
 */
async function removeSatOut(install: Install, due: readonly SiteId[], rule: { readonly trashedBy: number; readonly signed: Signed }): Promise<{ readonly deleted: number; readonly left: readonly string[] }> {
  const removed = await install.database.deleteSatOutSites(due, rule.signed, rule.trashedBy);
  const { left } = await emptyLeftovers(
    install,
    removed.map((site) => site.folder),
  );

  return { deleted: removed.length, left };
}

/** Remove what an old upload left in the store: the versions its publish dropped when it was made live, and its own files otherwise. */
function removeLeftovers(install: Install, upload: Upload): Promise<readonly string[]> {
  if (upload.state === "finished") return removeDropped(install, upload, upload.dropped);

  return removeUploadFiles(install, upload);
}

/** Remove the old uploads with what they left in the store. A record goes only once its files are gone, so a removal that ran out of pages is taken up by the next walk. Copies nobody finished are noted as the problem `copy_failed`, once a call. */
async function removeOldUploads(install: Install, uploads: readonly Upload[]): Promise<{ readonly uploads: number; readonly left: readonly string[] }> {
  const left: string[] = [];
  let removed = 0;
  let noted = false;

  for (const upload of uploads) {
    // A pending upload is given up first, so nothing can finish it while its files go.
    if (upload.state === "pending" && !(await install.database.abandonUpload(upload.id))) continue;

    // A copy still pending here ended with no site, and nothing else told anybody. One note a call keeps a step to one call to the database for it.
    if (upload.state === "pending" && upload.plan.kind === "duplicate" && !noted) {
      await noteProblem(install, "copy_failed");
      noted = true;
    }

    const remaining = await removeLeftovers(install, upload);
    left.push(...remaining);
    if (remaining.length > 0) continue;

    if (await install.database.removeUpload(upload.id)) removed += 1;
  }

  return { uploads: removed, left };
}

/**
 * One step over the sites that expired, or over the ones that sat out their days in the trash. Only the due ones are listed, the longest due first, and each leaves its list as it is dealt with.
 * So a step that filled its limit is followed by another at the same place, and one that did not ends its part of the walk.
 */
async function sweepSites(install: Install, from: Extract<SweepPlace, { readonly trash: boolean }>, rule: { readonly limit: number; readonly trashDays: number; readonly signed: Signed }): Promise<Swept> {
  const trashedBy = rule.signed.at - rule.trashDays * DAY_MS;
  const due = await install.database.listDueSites(from.trash ? { trashedBy } : { expiredBy: rule.signed.at }, rule.limit);
  // A site given a later expiry since it was listed stays: the move itself checks.
  const trashed = from.trash ? 0 : await install.database.trashExpiredSites(due, rule.signed);
  const { deleted, left } = from.trash ? await removeSatOut(install, due, { trashedBy, signed: rule.signed }) : { deleted: 0, left: [] };

  const done = { ...NOTHING_SWEPT, trashed, deleted, left };
  if (due.length === rule.limit) return { ...done, next: { trash: from.trash } };

  return { ...done, next: from.trash ? { uploads: true } : { trash: true } };
}

/** One step over the old uploads. */
async function sweepUploads(install: Install, from: Extract<SweepPlace, { readonly uploads: true }>, rule: { readonly limit: number; readonly signed: Signed }): Promise<Swept> {
  const old = await install.database.listUploads({ before: sweepableBefore(rule.signed.at), limit: rule.limit, after: from.after });
  const removed = await removeOldUploads(install, old.uploads);

  return { ...NOTHING_SWEPT, ...removed, next: old.next === undefined ? { leftovers: true } : { uploads: true, after: old.next } };
}

/** One step over the leftovers. The one that has looked at the last of them ends the walk by removing the logins that ran out, the problems past the days kept, and a bounded number of the audit entries and ended tokens past theirs. */
async function sweepLeftovers(install: Install, from: Extract<SweepPlace, { readonly leftovers: true }>, rule: { readonly limit: number; readonly signed: Signed }): Promise<Swept> {
  const page = await install.database.listLeftovers({ limit: rule.limit, after: from.after });
  const swept = { ...NOTHING_SWEPT, ...(await emptyLeftovers(install, page.folders)) };
  if (page.next !== undefined) return { ...swept, next: { leftovers: true, after: page.next } };

  return { ...swept, logins: await install.database.sweepRunOut(rule.signed.at) };
}

/**
 * Take one step of the walk that moves every site past its expiry to the trash, removes for good every site that has sat in the trash for `trash_days`, and removes every upload begun over 25 hours ago.
 * The walk ends by removing the files removed sites left behind, then every login of a computer that ran out, and the audit entries and ended tokens of over 90 days ago, a bounded number a walk.
 *
 * One step lists once, up to `limit` due items, so its cost is bounded: due sites are changed in one query and emptied folders forgotten in one, with one bounded file removal per item. A step over the uploads notes at most one problem more.
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
