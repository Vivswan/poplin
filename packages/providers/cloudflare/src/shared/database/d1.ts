// Core's SQL driver on a D1 database binding.
//
// D1 says with every answer how many rows the statement read and wrote: the numbers its daily allowance is counted in.
// The driver adds them up for its instance, UTC day by UTC day, until the day's count takes them. A statement D1 rejected names none, so it adds nothing.
// D1 also says with every answer how large the database is after the statement, in bytes: the driver keeps the last size it was told.
// Only the day that is running is held: what is left of a day when the next one begins is dropped, and so are the rows of a batch that was sent on one day and answered on the next. No day is given the rows of another.

import type { RowsUsed } from "@poplin/core/src/database/database";
import type { SqlDriver, Statement, StatementResult } from "@poplin/core/src/database/driver";
import { dayOf } from "@poplin/core/src/records/views";
import { allowanceSpent } from "./allowance";

/** No rows of the database: what a day begins with, and what is held of any day but the running one. */
const NO_ROWS: RowsUsed = { read: 0, written: 0 };

/** A D1 database behind core's driver interface. D1 enforces foreign keys and runs a batch as one transaction. A day's allowance used up is thrown as core's `AllowanceSpent`. */
export class D1Driver implements SqlDriver {
  readonly #database: D1Database;

  readonly #now: () => number;

  #day = "";

  #rows: RowsUsed = NO_ROWS;

  #bytes: number | undefined;

  /**
   * @param now - the clock, in milliseconds since the epoch, which says the UTC day a statement's rows are of; the runtime's own when absent
   */
  constructor(database: D1Database, now: () => number = Date.now) {
    this.#database = database;
    this.#now = now;
  }

  async batch(statements: readonly Statement[]): Promise<readonly StatementResult[]> {
    const day = dayOf(this.#now());
    const prepared = statements.map((statement) => this.#database.prepare(statement.sql).bind(...statement.params));
    const results = await this.#database.batch<Record<string, unknown>>(prepared).catch((error: unknown) => {
      throw allowanceSpent(error) ?? error;
    });

    this.#bytes = results.at(-1)?.meta.size_after ?? this.#bytes;
    if (dayOf(this.#now()) === day) {
      this.returnRows(day, {
        read: results.reduce((sum, result) => sum + result.meta.rows_read, 0),
        written: results.reduce((sum, result) => sum + result.meta.rows_written, 0),
      });
    }

    return results.map((result) => ({ rows: result.results, changes: result.meta.changes }));
  }

  /** The bytes the database held after the last statement D1 answered this instance; `undefined` before the first. */
  heldBytes(): number | undefined {
    return this.#bytes;
  }

  /**
   * The rows D1 read and wrote for this instance on a UTC day since they were last taken. Nothing is taken.
   *
   * @param day - a UTC date, such as `2026-11-13`
   * @returns none for any day but the one the last statement ran on
   */
  heldRows(day: string): RowsUsed {
    return day === this.#day ? this.#rows : NO_ROWS;
  }

  /** Take the rows `heldRows` answers for a day: the next taking of that day begins at none. */
  takeRows(day: string): RowsUsed {
    const taken = this.heldRows(day);
    if (day === this.#day) this.#rows = NO_ROWS;

    return taken;
  }

  /** Add rows to a day: the ones a statement just used, or ones that were taken and then not written down. Rows of a day before the one held are dropped, and rows of a later day begin it. */
  returnRows(day: string, rows: RowsUsed): void {
    if (day < this.#day) return;

    const held = this.heldRows(day);
    this.#day = day;
    this.#rows = { read: held.read + rows.read, written: held.written + rows.written };
  }
}
