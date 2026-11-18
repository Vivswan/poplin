// The runner: it reads the steps the database is stamped with and applies the steps the code has beyond them, each as one atomic unit.

import { sha256Hex } from "../auth/util";
import { AllowanceSpent, type SqlDriver, type Statement } from "../database/driver";

/** The name of the ledger's table. A database that holds it is one the runner has stamped. */
export const LEDGER_TABLE = "schema_steps";

/** The ledger: one row per applied step, with its place, its version and name, and the fingerprint of the statements it ran. The highest place in it is the schema version, and the table is the only one the runner makes itself. */
const CREATE_LEDGER = `
CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  step INTEGER NOT NULL PRIMARY KEY CHECK (step >= 1),
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  fingerprint TEXT NOT NULL
) STRICT`;

/** Whether the ledger exists; a database no step ran on has none. It reads a row for everything the schema holds, so it is asked only once the ledger could not be read. */
const HAS_LEDGER = `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = '${LEDGER_TABLE}'`;

/** Every applied step as the ledger holds it, in order. The last one is the schema version. */
const APPLIED_STEPS = `SELECT * FROM ${LEDGER_TABLE} ORDER BY step`;

/** The stamp of a step, under its place. Its primary key refuses a step another runner applied, which fails the batch before the step's own statements run. */
const STAMP = `INSERT INTO ${LEDGER_TABLE} (step, version, name, description, applied_at, fingerprint) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`;

/** What stands between two statements where a step's fingerprint is taken. */
const STATEMENT_END = "\n;\n";

/** Who can do a step: the install by itself, with what it holds; or only a repair, which is given an account token. */
export type StepBy = "install" | "account token";

/** One change of schema, as the file of its version writes it. */
interface VersionStep {
  /** What the step is called within its version, in lower case with hyphens; no other step of the version has it. */
  readonly name: string;

  /** What the step changes, in a few words; reports quote it. */
  readonly description: string;

  /** Who can do the step. A change of schema is the install's own: the runner applies every step in its place, so none waits for a repair. */
  readonly by: Extract<StepBy, "install">;

  /** The SQL of the step, one statement each. They run in order with the stamp, all or none. */
  readonly statements: readonly string[];
}

/** The steps that take a database on from one release: the file `<version>.ts`, written while that release is the newest. */
export interface VersionSteps {
  /** The release the steps migrate away from, as a bare `X.Y.Z`: the name of the file. */
  readonly version: string;

  /** The steps, in the order they run. */
  readonly steps: readonly VersionStep[];
}

/** One change of schema among all the code knows. Its place in that list, counted from 1, is the schema version it leaves a database at. */
export interface Step extends VersionStep {
  /** The release the step migrates away from. */
  readonly version: string;
}

/**
 * The answer to `migrate`.
 *
 * `current`: the database is at the code's version; `applied` describes the steps this call ran, none when it was already there.
 *
 * `newer`: the database was written by a newer poplin; nothing was changed. `failed`: a step could not run; nothing of it was kept and the database is left at `stored`; `failure` is what the driver threw.
 *
 * `differs`: the step at the place `step` was applied by another build of poplin: under another version or name, with other statements than this code's, or with no fingerprint; nothing was changed.
 */
export type Migrated =
  | { readonly kind: "current"; readonly version: number; readonly applied: readonly string[] }
  | { readonly kind: "newer"; readonly stored: number; readonly current: number; readonly message: string }
  | { readonly kind: "differs"; readonly stored: number; readonly step: number; readonly message: string }
  | { readonly kind: "failed"; readonly stored: number; readonly step: number; readonly message: string; readonly failure: unknown };

/** Where a database stands before any step is applied: at a version this code can go on from, or one of the two it refuses. */
type Standing = { readonly kind: "at"; readonly version: number } | Extract<Migrated, { kind: "newer" | "differs" }>;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newer(stored: number, current: number): Standing {
  return { kind: "newer", stored, current, message: `the database is at schema version ${stored} and this poplin knows up to ${current}: update poplin` };
}

/** What a line calls a step: its version, then its name. */
export function stepLabel(step: Pick<Step, "version" | "name">): string {
  return `${step.version}/${step.name}`;
}

function differs(stored: number, place: number, step: Step): Standing {
  const what = `step ${stepLabel(step)} (${step.description}) of the database was applied by another build of poplin, so its tables are not the ones this build reads`;

  return { kind: "differs", stored, step: place, message: `${what}. Run the build that made the database, or delete the database and poplin makes it anew` };
}

/** The fingerprint a step is stamped with: the SHA-256 of its statements in order, so a step changed by one character has another. */
function fingerprintOf(step: Step): Promise<string> {
  return sha256Hex(step.statements.join(STATEMENT_END));
}

/**
 * Read the applied steps as the ledger holds them, in order: none for a database that has no ledger, which is one no step ran on.
 *
 * @throws {AllowanceSpent} the day's allowance of the database is used up
 * @throws whatever the driver rejects with, when the ledger is there and still cannot be read
 */
async function appliedSteps(driver: SqlDriver): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const read = async (): Promise<readonly Readonly<Record<string, unknown>>[]> => (await driver.batch([{ sql: APPLIED_STEPS, params: [] }]))[0]?.rows ?? [];

  try {
    return await read();
  } catch (error) {
    if (error instanceof AllowanceSpent) throw error;

    // The read fails on a database with no ledger. Whether that is why it failed is asked of the schema itself.
    const [ledger] = await driver.batch([{ sql: HAS_LEDGER, params: [] }]);
    if (ledger?.rows.length !== 1) return [];

    // The ledger is there: another runner made it since the read, or the read failed for another reason, which reading again tells.
    return read();
  }
}

/**
 * Read where a database stands against the given steps. Nothing is written.
 *
 * @param steps - every step the code knows, in the order they run
 * @returns `at` with the stored schema version, 0 for a database no step has run on; `newer` for one with a step beyond the code's; `differs` for one whose applied step is not the code's
 */
export async function readStanding(driver: SqlDriver, steps: readonly Step[]): Promise<Standing> {
  const rows = await appliedSteps(driver);
  const stored = Number(rows.at(-1)?.step ?? 0);
  if (stored > steps.length) return newer(stored, steps.length);

  for (const [at, step] of steps.slice(0, stored).entries()) {
    const row = rows[at];
    const marked = row?.step === at + 1 && row.version === step.version && row.name === step.name && row.fingerprint === (await fingerprintOf(step));
    if (!marked) return differs(stored, at + 1, step);
  }

  return { kind: "at", version: stored };
}

/**
 * Bring a database up to the schema version of the given steps.
 *
 * Each pending step runs with its stamp in one transaction. Two runners may start at once: the one that loses a step finds it stamped and goes on to the next.
 *
 * @param steps - every step the code knows, in the order they run
 * @param now - the clock, in milliseconds since the epoch; stamped beside each step
 * @returns where the database stands now; only `current` means it can be used
 */
export async function migrate(driver: SqlDriver, steps: readonly Step[], now: number): Promise<Migrated> {
  let standing = await readStanding(driver, steps);
  const applied: string[] = [];

  while (standing.kind === "at" && standing.version < steps.length) {
    const step = steps[standing.version];
    if (step === undefined) break;

    const place = standing.version + 1;
    const stamp: Statement = { sql: STAMP, params: [place, step.version, step.name, step.description, now, await fingerprintOf(step)] };
    const statements = step.statements.map((sql): Statement => ({ sql, params: [] }));

    try {
      await driver.batch([{ sql: CREATE_LEDGER, params: [] }, stamp, ...statements]);
      applied.push(step.description);
      standing = { kind: "at", version: place };
    } catch (error) {
      // No step failed: the database takes no more for the day, and says so itself.
      if (error instanceof AllowanceSpent) throw error;

      // Another runner may have applied the step meanwhile: then its stamp is there.
      const stored = standing.version;
      standing = await readStanding(driver, steps);
      if (standing.kind !== "at" || standing.version > stored) continue;

      const message = `the database could not be brought up to date: step ${stepLabel(step)} (${step.description}) failed and nothing of it was kept: ${messageOf(error)}. Try again`;

      return { kind: "failed", stored, step: place, message, failure: error };
    }
  }

  return standing.kind === "at" ? { kind: "current", version: standing.version, applied } : standing;
}
