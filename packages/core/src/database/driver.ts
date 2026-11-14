// The one thing core asks of a SQLite database: run statements, in order, as one atomic unit, and say so when its day of free use is over. Every SQL text lives in core; a driver only carries it.

/** The milliseconds of one day. */
const DAY_MS = 86_400_000;

/** The milliseconds of one second. */
const SECOND_MS = 1000;

/** A value SQLite stores, as a parameter is bound. */
export type SqlValue = string | number | null;

/** One SQL statement and the values of its `?1`, `?2`, ... parameters, in that order. */
export interface Statement {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

/** What one statement gave: the rows a `SELECT` returned, and how many rows an `INSERT`, `UPDATE`, or `DELETE` changed (0 for a `SELECT`). */
export interface StatementResult {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly changes: number;
}

/** A SQLite database with foreign keys enforced. */
export interface SqlDriver {
  /**
   * Run statements in order as one transaction: every one takes effect, or none does.
   *
   * @returns one result per statement, in order
   * @throws {AllowanceSpent} the day's free allowance of the database is used up
   * @throws {Error} a statement failed, by a constraint or otherwise; nothing of the batch was kept
   */
  batch(statements: readonly Statement[]): Promise<readonly StatementResult[]>;
}

/**
 * What a driver throws once the day's free allowance of its database is used up. Nothing of the batch was kept, and the same batch works again from the next midnight UTC.
 *
 * `spent` says which allowance ran out: with `writing` spent the database still answers a batch that changes nothing.
 */
export class AllowanceSpent extends Error {
  readonly spent: "reading" | "writing";

  constructor(spent: "reading" | "writing", options?: ErrorOptions) {
    super(`the day's free allowance of the database for ${spent} is used up`, options);
    this.name = "AllowanceSpent";
    this.spent = spent;
  }
}

/**
 * Count the seconds to the next midnight UTC, when a day's allowance begins anew.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns whole seconds, at least one: what a `Retry-After` header takes
 */
export function secondsToNextDay(now: number): number {
  return Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / SECOND_MS));
}
