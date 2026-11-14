// The sweep a scheduled job runs: expired sites go to the trash, and sites whose time in the trash has passed go for good.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import type { Signed } from "../database/database";
import { MOMENT, POSITIVE, SITE_ID } from "../records/fields";
import type { Site } from "../records/site";
import { removeSite } from "./delete";
import { enterInstall } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { DAY_MS } from "./site-object";

/** The most sites one call looks at. */
const MAX_STEP = 100;

/** Where a walk stands: in the sites or in the trash, after which site. */
const PLACE = v.strictObject({ trash: v.boolean(), after: v.optional(v.strictObject({ updated_at: MOMENT, id: SITE_ID })) });

/** What one call of the sweep may ask for. */
const STEP = v.strictObject({ limit: v.pipe(POSITIVE, v.maxValue(MAX_STEP)), from: v.optional(PLACE, { trash: false }) });

/**
 * What one call did. `next` is where the walk goes on, and is absent once it has looked at every site and all of the trash.
 *
 * `left` names the prefixes of removed sites that may still hold files.
 */
interface Swept {
  readonly ok: true;
  readonly trashed: number;
  readonly deleted: number;
  readonly left: readonly string[];
  readonly next?: v.InferOutput<typeof PLACE>;
}

/** Move the sites past their expiry to the trash, and answer how many went. */
async function trashExpired(install: Install, sites: readonly Site[], signed: Signed): Promise<number> {
  let trashed = 0;

  for (const listed of sites) {
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

/**
 * Take one step of the walk that moves every site past its expiry to the trash, then removes for good every site that has sat in the trash for `trash_days`.
 *
 * One step lists once and looks at up to `limit` sites, so its cost is bounded: one read per site looked at, one change per site moved or removed, and one bounded file removal per site removed. A walk run again at the same moment finds nothing left to do.
 *
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
  const page = await install.database.listSites({ trash: from.trash, limit, after: from.after });
  const trashed = from.trash ? 0 : await trashExpired(install, page.sites, signed);
  const { deleted, left } = from.trash ? await removeSatOut(install, page.sites, { trashDays: settings.trash_days, signed }) : { deleted: 0, left: [] };

  const done = { ok: true as const, trashed, deleted, left };
  if (page.next !== undefined) return { ...done, next: { trash: from.trash, after: page.next } };

  if (!from.trash) return { ...done, next: { trash: true } };

  return done;
}
