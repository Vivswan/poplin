// Rollback: make an earlier kept version of a site the live one. No file moves.

import * as v from "valibot";

import type { Actor } from "../../auth/scopes";
import type { Database } from "../../database/database";
import { POSITIVE } from "../../records/fields";
import type { Site } from "../../records/site";
import { reachSite } from "../access/reach";
import { type Install, type Refused, type Rehearsal, refuse } from "../records";
import { type SiteAnswer, siteAnswer } from "./site-object";

/** What a rollback may ask for besides its site: the version to go to. */
export const ROLLBACK_OPTIONS = v.strictObject({ version: v.optional(POSITIVE) });

/** The codes a rollback may be refused with. */
type RollbackCode = "not_set_up" | "bad_argument" | "not_found" | "not_allowed" | "in_trash" | "no_such_version";

/** What moving the live version of a site as it was read would come to, by the rule the database moves it by, with nothing written. */
function rehearsedMove(site: Site, target: number | "previous", at: number): Awaited<ReturnType<Database["setLiveVersion"]>> {
  if (site.state === "trash") return { kind: "in_trash" };

  const kept = target === "previous" ? site.versions.filter((version) => version.number < site.live_version).pop() : site.versions.find((version) => version.number === target);
  if (kept === undefined) return { kind: "no_such_version" };

  return kept.number === site.live_version ? { kind: "unchanged", site } : { kind: "done", site: { ...site, live_version: kept.number, updated_at: at } };
}

/**
 * Go back to a kept version of a site. Only the content changes; the settings stay.
 *
 * @param request - `site` is a reference to the site. `version` is the number to go to; without it the site goes to the highest kept version below the live one. With `dry_run` nothing is changed
 * @returns the site at its new live version; a `version` that is live already changes nothing. `no_such_version` when the number is not kept, or no kept version is below the live one
 */
export async function rollbackSite(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof ROLLBACK_OPTIONS> & Rehearsal & { readonly site: string },
): Promise<SiteAnswer | Refused<RollbackCode>> {
  const reached = await reachSite(install, actor, request.site);
  if (!reached.ok) return reached;

  const target = request.version ?? "previous";
  if (!v.is(ROLLBACK_OPTIONS, { version: request.version })) return refuse("bad_argument", "version");

  const moved = request.dry_run === true ? rehearsedMove(reached.site, target, reached.signed.at) : await install.database.setLiveVersion(reached.site.id, target, reached.signed);
  if (moved.kind !== "done" && moved.kind !== "unchanged") return refuse(moved.kind);

  return siteAnswer({ before: reached.site, after: moved.site }, install, reached.settings);
}
