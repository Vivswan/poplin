// The account's D1 database, which holds every record. D1 keeps no mark on a database, so poplin's is the one with its fixed name, which the OpenTofu module gives it too.
// Nothing here applies a schema: the Worker brings the database up to its own when it opens it.

import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import { type Connection, callCloudflare } from "../client";
import { INSTALL_OBJECTS } from "../install-objects";
import { applySteps, type Mode, type Report, reportOf, type SyncFailure } from "../sync";

const NAME = INSTALL_OBJECTS.database;

/** A database as the account has it now. */
interface AccountDatabase {
  readonly uuid?: string;
  readonly name?: string;
}

/** One step of a database plan; a `leave` carries the id of the database found. */
type DatabaseStep = { readonly kind: "create"; readonly subject: typeof NAME } | { readonly kind: "leave"; readonly subject: typeof NAME; readonly id: string };

/** A finished run with the id the Worker's `DB` binding takes, or the failure that stopped it. The id is absent only from a plan that would create the database. `no-id` means Cloudflare's reply named no database. */
type DatabaseSynced =
  | { readonly ok: true; readonly report: Report; readonly id: string | undefined }
  | { readonly ok: false; readonly failure: "no-id"; readonly report: Report }
  | SyncFailure;

/**
 * Compute the change that gives the account poplin's database.
 *
 * @param databases - the account's databases as they are now
 * @returns one step: a `leave` for the database with poplin's name, whatever it holds, or a `create`; no step names another database
 */
export function planDatabase(databases: readonly AccountDatabase[]): DatabaseStep[] {
  const own = databases.find((database) => database.name === NAME && database.uuid !== undefined);
  if (own?.uuid === undefined) return [{ kind: "create", subject: NAME }];

  return [{ kind: "leave", subject: NAME, id: own.uuid }];
}

/**
 * Make sure the account has poplin's database.
 *
 * @param mode - `plan` reads the account's databases and sends no change
 * @returns what was created or left, and the database's id; a database with poplin's name is taken as it is, and no schema is applied
 */
export async function syncDatabase(connection: Connection, accountId: string, mode: Mode): Promise<DatabaseSynced> {
  // The `name` filter is a search, so the plan still compares each name in full.
  const listed = await callCloudflare(connection, (api) => Array.fromAsync(new BaseDatabase(api).list({ account_id: accountId, name: NAME })));
  if (!listed.ok) return { ...listed, report: reportOf([]) };

  const steps = planDatabase(listed.value);
  let id = steps.flatMap((step) => (step.kind === "leave" ? [step.id] : []))[0];

  const synced = await applySteps(steps, async () => {
    const created = await callCloudflare(connection, (api) => new BaseDatabase(api).create({ account_id: accountId, name: NAME }));
    if (created.ok) id = created.value.uuid;

    return created;
  }, mode);
  if (!synced.ok) return synced;

  if (id === undefined && mode === "apply") return { ok: false, failure: "no-id", report: synced.report };

  return { ...synced, id };
}
