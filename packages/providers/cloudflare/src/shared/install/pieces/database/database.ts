// The account's D1 database, which holds every record. D1 keeps no mark on a database, so poplin's is the one with its fixed name.
// Nothing here applies a schema: the Worker brings the database up to its own when it opens it.
// Where no Worker is bound to it, its tables say whose it is: the Worker stamps a ledger of schema steps into the database it opens.

import { isStamped } from "@poplin/core/src/database/open";
import { BaseDatabase } from "cloudflare/resources/d1/database/database";
import * as v from "valibot";
import { type CloudflareFailure, type CloudflareResult, type Connection, callCloudflare } from "../../client";
import { BY_NAME, INSTALL_OBJECTS } from "../../install-objects";
import { applySteps, type Mode, type Report, reportOf, type SyncFailure } from "../../sync";

/** The name of poplin's database. */
const NAME = INSTALL_OBJECTS.database;

/** The one question that tells whose a database is: the names of its tables. */
const TABLES = "SELECT name FROM sqlite_master WHERE type = 'table'";

/** The only answer to that question that is read: one statement that the database says it ran, with a name in every row. */
const TABLES_ANSWER = v.strictTuple([v.object({ success: v.literal(true), results: v.array(v.object({ name: v.string() })) })]);

/** What any other answer is: no table was read, so the database is neither poplin's, nor empty, nor somebody else's. */
const UNREAD: CloudflareFailure = { ok: false, failure: "network", message: "the database's answer named no tables" };

/** How the names of the tables the database's engine keeps for itself start. */
const ENGINE_TABLES = ["_cf_", "sqlite_"];

/** What each holder of a database of the name is told in, where the name alone matched it. */
const HOLDER_WORDS = { poplin: `${BY_NAME}; poplin's by its schema steps`, empty: `empty; ${BY_NAME}`, other: `${BY_NAME}, and it holds tables that are not poplin's` } as const;

/** A database as the account has it now. */
interface AccountDatabase {
  readonly uuid?: string;
  readonly name?: string;
}

/** Whose a database of poplin's name is, by its tables: `poplin` holds the ledger of schema steps, `empty` holds no table, and `other` holds tables and no ledger. */
export type DatabaseHolder = keyof typeof HOLDER_WORDS;

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
 * Read whose a database of poplin's name is, where no Worker is bound to it. Nothing is written.
 *
 * @param id - the database's id
 * @returns whose it is; a failure also for an answer that is not the tables' names from a statement that ran, since only a database read as poplin's or as empty may be used or deleted
 */
export async function readHolder(connection: Connection, accountId: string, id: string): Promise<CloudflareResult<DatabaseHolder>> {
  const asked = await callCloudflare(connection, (api) => Array.fromAsync(new BaseDatabase(api).query(id, { account_id: accountId, sql: TABLES })));
  if (!asked.ok) return asked;

  const answer = v.safeParse(TABLES_ANSWER, asked.value);
  if (!answer.success) return UNREAD;

  const names = answer.output[0].results.map((row) => row.name);
  if (isStamped(names)) return { ok: true, value: "poplin" };

  const own = names.filter((name) => !ENGINE_TABLES.some((start) => name.startsWith(start)));

  return { ok: true, value: own.length === 0 ? "empty" : "other" };
}

/** What a row says of a database the name alone matched. */
export function holderWords(holder: DatabaseHolder): string {
  return HOLDER_WORDS[holder];
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
