// Going back after an update: to the version the install ran before the last update it took by itself.
//
//   a person goes back      offered while the running code is the code that update put in place, the version before is the lower one, and the database is at the schema it was at then
//                           it is a start of an update to that version: fetched, checked, and put in place as any release is
//   the install goes back   a step of the new code's schema failed at its first start, so the database is still at the schema of the version before: the host puts that code back
//
// An update that changed the database is never gone back from: the code before cannot read it.
// What the install knows of its last update is kept by the host beside the code that update put in place, so code put in place any other way knows of none.

import lt from "semver/functions/lt";
import * as v from "valibot";

import { SWEEPER } from "../../auth/scopes";
import { OWN_SCHEMA } from "../../database/open";
import { MOMENT } from "../../records/fields";
import { LAST_UPDATE, type LastUpdate } from "../../records/update";
import { noteProblem } from "../install/problems";
import { signedBy } from "../access/reach";
import type { Install } from "../records";

/** The version an install can go back to, and since when it runs the version it would leave. */
export const WAY_BACK = v.object({ to: LAST_UPDATE.entries.from, since: MOMENT });

/** The version an install can go back to. */
export type WayBack = Readonly<v.InferOutput<typeof WAY_BACK>>;

/** Whether the running code is the code the last update put in place, over a lower version. */
function tookIt(last: LastUpdate, running: string): boolean {
  return last.to === running && lt(last.from, last.to);
}

/**
 * Say which version a person can go back to. Nothing is read.
 *
 * @param last - the update the install last took by itself, or `undefined` where its host keeps none
 * @param running - the version the install runs
 * @returns the version before and when the running one came in, or `undefined` where there is no way back: no update is known, the code was put in place another way since, or the update changed the database
 */
export function wayBack(last: LastUpdate | undefined, running: string): WayBack | undefined {
  if (last === undefined || !tookIt(last, running) || last.schema !== OWN_SCHEMA) return undefined;

  return { to: last.from, since: last.at };
}

/**
 * Say which version the install goes back to by itself, after a step of its schema failed as its code started. Nothing is read.
 *
 * @param failed - the version that runs, and the schema the database was left at
 * @returns the version before, or `undefined` where the install stays as it is: the code is not from its last update, or the database is no longer at the schema that version reads
 */
export function backAfterFailedStep(last: LastUpdate | undefined, failed: { readonly version: string; readonly stored: number }): string | undefined {
  if (last === undefined || !tookIt(last, failed.version) || last.schema !== failed.stored) return undefined;

  return last.from;
}

/**
 * Note that the install went back by itself: one audit entry, and the problem `update_went_back`. It never throws: the database is one step behind the code that writes, and may refuse either.
 *
 * @param went - the version whose step failed, and the version the install went back to
 */
export async function noteWentBack(install: Pick<Install, "database" | "now">, went: { readonly from: string; readonly to: string }): Promise<void> {
  await install.database.appendAudit({ action: "update_went_back", detail: went }, signedBy(SWEEPER, install.now())).catch(() => undefined);
  await noteProblem(install, "update_went_back");
}
