// The runner: it reads the schema version the database is stamped with and applies the steps the code has beyond it, each as one atomic unit.

import type { SqlDriver, Statement } from "../database/driver";

/** The ledger: one row per applied step. The highest step in it is the schema version, and the table is the only one the runner makes itself. */
const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS schema_steps (
  step INTEGER NOT NULL PRIMARY KEY CHECK (step >= 1),
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT`;

/** Whether the ledger exists; a database no step ran on has none. */
const HAS_LEDGER = "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_steps'";

/** The schema version: the highest step in the ledger. */
const HIGHEST_STEP = "SELECT COALESCE(MAX(step), 0) AS version FROM schema_steps";

/** The stamp of a step. Its primary key refuses a step another runner applied, which fails the batch before the step's own statements run. */
const STAMP = "INSERT INTO schema_steps (step, description, applied_at) VALUES (?1, ?2, ?3)";

/** One change of schema: it takes a database at version `number - 1` to version `number`. */
export interface Step {
  /** The schema version the step leaves the database at; steps count from 1 with no gap. */
  readonly number: number;

  /** What the step changes, in a few words; reports quote it. */
  readonly description: string;

  /** The SQL of the step, one statement each. They run in order with the stamp, all or none. */
  readonly statements: readonly string[];
}

/**
 * The answer to `migrate`.
 *
 * `current`: the database is at the code's version; `applied` describes the steps this call ran, none when it was already there.
 *
 * `newer`: the database was written by a newer poplin; nothing was changed. `failed`: a step could not run; nothing of it was kept and the database is left at `stored`.
 */
export type Migrated =
  | { readonly kind: "current"; readonly version: number; readonly applied: readonly string[] }
  | { readonly kind: "newer"; readonly stored: number; readonly current: number; readonly message: string }
  | { readonly kind: "failed"; readonly stored: number; readonly step: number; readonly message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newer(stored: number, current: number): Migrated {
  return { kind: "newer", stored, current, message: `the database is at schema version ${stored} and this poplin knows up to ${current}: update poplin` };
}

function stepLabel(step: Step): string {
  return String(step.number).padStart(4, "0");
}

/**
 * Read the schema version a database is stamped with. Nothing is written.
 *
 * @returns the number of the highest applied step, 0 for a database no step has run on
 */
export async function storedVersion(driver: SqlDriver): Promise<number> {
  const [ledger] = await driver.batch([{ sql: HAS_LEDGER, params: [] }]);
  if (ledger?.rows.length !== 1) return 0;

  const [highest] = await driver.batch([{ sql: HIGHEST_STEP, params: [] }]);

  return Number(highest?.rows[0]?.version);
}

/**
 * Bring a database up to the schema version of the given steps.
 *
 * Each pending step runs with its stamp in one transaction. Two runners may start at once: the one that loses a step finds it stamped and goes on to the next.
 *
 * @param steps - every step the code knows, in ascending order from 1
 * @param now - the clock, in milliseconds since the epoch; stamped beside each step
 * @returns where the database stands now; only `current` means it can be used
 */
export async function migrate(driver: SqlDriver, steps: readonly Step[], now: number): Promise<Migrated> {
  const current = steps.length;
  let stored = await storedVersion(driver);
  if (stored > current) return newer(stored, current);

  const applied: string[] = [];

  for (const step of steps.slice(stored)) {
    const stamp: Statement = { sql: STAMP, params: [step.number, step.description, now] };
    const statements = step.statements.map((sql): Statement => ({ sql, params: [] }));

    try {
      await driver.batch([{ sql: CREATE_LEDGER, params: [] }, stamp, ...statements]);
      applied.push(step.description);
      stored = step.number;
    } catch (error) {
      stored = await storedVersion(driver);
      if (stored >= step.number) continue;

      const message = `the database could not be brought up to date: step ${stepLabel(step)} (${step.description}) failed and nothing of it was kept: ${messageOf(error)}. Try again`;

      return { kind: "failed", stored, step: step.number, message };
    }
  }

  if (stored > current) return newer(stored, current);

  return { kind: "current", version: stored, applied };
}
