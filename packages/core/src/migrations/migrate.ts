// The runner: it reads the steps the database is stamped with and applies the steps the code has beyond them, each as one atomic unit.

import { sha256Hex } from "../auth/util";
import { AllowanceSpent, type SqlDriver, type Statement } from "../database/driver";

/** The ledger: one row per applied step, with the fingerprint of the statements it ran. The highest step in it is the schema version, and the table is the only one the runner makes itself. */
const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS schema_steps (
  step INTEGER NOT NULL PRIMARY KEY CHECK (step >= 1),
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  fingerprint TEXT NOT NULL
) STRICT`;

/** Whether the ledger exists; a database no step ran on has none. */
const HAS_LEDGER = "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_steps'";

/** Every applied step as the ledger holds it, in order. The last one is the schema version. */
const APPLIED_STEPS = "SELECT * FROM schema_steps ORDER BY step";

/** The stamp of a step. Its primary key refuses a step another runner applied, which fails the batch before the step's own statements run. */
const STAMP = "INSERT INTO schema_steps (step, description, applied_at, fingerprint) VALUES (?1, ?2, ?3, ?4)";

/** What stands between two statements where a step's fingerprint is taken. */
const STATEMENT_END = "\n;\n";

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
 *
 * `differs`: `step` was applied by another build of poplin, with other statements than this code's or with no fingerprint; nothing was changed.
 */
export type Migrated =
  | { readonly kind: "current"; readonly version: number; readonly applied: readonly string[] }
  | { readonly kind: "newer"; readonly stored: number; readonly current: number; readonly message: string }
  | { readonly kind: "differs"; readonly stored: number; readonly step: number; readonly message: string }
  | { readonly kind: "failed"; readonly stored: number; readonly step: number; readonly message: string };

/** Where a database stands before any step is applied: at a version this code can go on from, or one of the two it refuses. */
type Standing = { readonly kind: "at"; readonly version: number } | Extract<Migrated, { kind: "newer" | "differs" }>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newer(stored: number, current: number): Standing {
  return { kind: "newer", stored, current, message: `the database is at schema version ${stored} and this poplin knows up to ${current}: update poplin` };
}

function stepLabel(step: Step): string {
  return String(step.number).padStart(4, "0");
}

function differs(stored: number, step: Step): Standing {
  const what = `step ${stepLabel(step)} (${step.description}) of the database was applied by another build of poplin, so its tables are not the ones this build reads`;

  return { kind: "differs", stored, step: step.number, message: `${what}. Run the build that made the database, or delete the database and poplin makes it anew` };
}

/** The fingerprint a step is stamped with: the SHA-256 of its statements in order, so a step changed by one character has another. */
function fingerprintOf(step: Step): Promise<string> {
  return sha256Hex(step.statements.join(STATEMENT_END));
}

/**
 * Read where a database stands against the given steps. Nothing is written.
 *
 * @param steps - every step the code knows, in ascending order from 1
 * @returns `at` with the stored schema version, 0 for a database no step has run on; `newer` for one with a step beyond the code's; `differs` for one whose applied step is not the code's
 */
export async function readStanding(driver: SqlDriver, steps: readonly Step[]): Promise<Standing> {
  const [ledger] = await driver.batch([{ sql: HAS_LEDGER, params: [] }]);
  if (ledger?.rows.length !== 1) return { kind: "at", version: 0 };

  const [applied] = await driver.batch([{ sql: APPLIED_STEPS, params: [] }]);
  const rows = applied?.rows ?? [];
  const stored = Number(rows.at(-1)?.step ?? 0);
  if (stored > steps.length) return newer(stored, steps.length);

  for (const step of steps.slice(0, stored)) {
    const row = rows[step.number - 1];
    if (row?.step !== step.number || row.fingerprint !== (await fingerprintOf(step))) return differs(stored, step);
  }

  return { kind: "at", version: stored };
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
  let standing = await readStanding(driver, steps);
  const applied: string[] = [];

  while (standing.kind === "at" && standing.version < steps.length) {
    const step = steps[standing.version];
    if (step === undefined) break;

    const stamp: Statement = { sql: STAMP, params: [step.number, step.description, now, await fingerprintOf(step)] };
    const statements = step.statements.map((sql): Statement => ({ sql, params: [] }));

    try {
      await driver.batch([{ sql: CREATE_LEDGER, params: [] }, stamp, ...statements]);
      applied.push(step.description);
      standing = { kind: "at", version: step.number };
    } catch (error) {
      // No step failed: the database takes no more for the day, and says so itself.
      if (error instanceof AllowanceSpent) throw error;

      // Another runner may have applied the step meanwhile: then its stamp is there.
      const stored = standing.version;
      standing = await readStanding(driver, steps);
      if (standing.kind !== "at" || standing.version > stored) continue;

      const message = `the database could not be brought up to date: step ${stepLabel(step)} (${step.description}) failed and nothing of it was kept: ${messageOf(error)}. Try again`;

      return { kind: "failed", stored, step: step.number, message };
    }
  }

  return standing.kind === "at" ? { kind: "current", version: standing.version, applied } : standing;
}
