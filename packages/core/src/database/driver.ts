// The one thing core asks of a SQLite database: run statements, in order, as one atomic unit. Every SQL text lives in core; a driver only carries it.

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
   * @throws {Error} a statement failed, by a constraint or otherwise; nothing of the batch was kept
   */
  batch(statements: readonly Statement[]): Promise<readonly StatementResult[]>;
}
