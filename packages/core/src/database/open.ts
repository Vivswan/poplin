// The doorway: the one place a database is opened, and the only file outside `migrations/` that knows a database can be at another schema version.

import { type Migrated, migrate, readStanding } from "../migrations/migrate";
import { STEPS } from "../migrations/registry";
import type { Database } from "./database";
import type { SqlDriver } from "./driver";
import { SqlDatabase } from "./sql-database";

/** The schema this code keeps a database at: the number of its steps. A release states its own, and an install compares the two. */
export const OWN_SCHEMA = STEPS.length;

/** A step that could not run. `behind` is the database as it stands, at the schema before that step: a note of what was done about it is tried there, and a write the step would have changed may fail. */
type Failed = Extract<Migrated, { kind: "failed" }> & { readonly behind: Database };

/** The answer to `openDatabase`: the database ready for use with the steps this call applied, or why it cannot be used. */
export type Opened = { readonly kind: "open"; readonly database: Database; readonly applied: readonly string[] } | Extract<Migrated, { kind: "newer" | "differs" }> | Failed;

/**
 * Read whether `openDatabase` would open the database. Nothing is written.
 *
 * @returns `at` with the stored schema version, 0 for a database no step has run on; else `newer` or `differs`, the two it refuses
 */
export function readOpening(driver: SqlDriver): ReturnType<typeof readStanding> {
  return readStanding(driver, STEPS);
}

/**
 * Open the database, bringing it up to this code's schema version first.
 *
 * A database behind the code has its pending steps applied here, each atomically. One written by a newer poplin, or by a build whose steps were not this code's, is refused and left as it is.
 *
 * @param now - the clock, in milliseconds since the epoch; stamped beside each step applied
 * @returns the database, or `newer`, `differs`, or `failed` with a message for the person running poplin
 */
export async function openDatabase(driver: SqlDriver, now: number): Promise<Opened> {
  const migrated = await migrate(driver, STEPS, now);
  if (migrated.kind === "failed") return { ...migrated, behind: new SqlDatabase(driver) };

  if (migrated.kind !== "current") return migrated;

  return { kind: "open", database: new SqlDatabase(driver), applied: migrated.applied };
}
