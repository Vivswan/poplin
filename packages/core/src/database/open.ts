// The doorway: the one place a database is opened, and the only file outside `migrations/` that knows a database can be at another schema version.

import { type Migrated, migrate } from "../migrations/migrate";
import { STEPS } from "../migrations/registry";
import type { Database } from "./database";
import type { SqlDriver } from "./driver";
import { SqlDatabase } from "./sql-database";

/** The answer to `openDatabase`: the database ready for use with the steps this call applied, or why it cannot be used. */
export type Opened = { readonly kind: "open"; readonly database: Database; readonly applied: readonly string[] } | Exclude<Migrated, { kind: "current" }>;

/**
 * Open the database, bringing it up to this code's schema version first.
 *
 * A database behind the code has its pending steps applied here, each atomically. One written by a newer poplin is refused and left as it is.
 *
 * @param now - the clock, in milliseconds since the epoch; stamped beside each step applied
 * @returns the database, or `newer` or `failed` with a message for the person running poplin
 */
export async function openDatabase(driver: SqlDriver, now: number): Promise<Opened> {
  const migrated = await migrate(driver, STEPS, now);
  if (migrated.kind !== "current") return migrated;

  return { kind: "open", database: new SqlDatabase(driver), applied: migrated.applied };
}
