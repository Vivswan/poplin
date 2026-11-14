// Core's SQL driver on bun's built-in SQLite, in memory: the tests run the same SQL here that D1 runs in the Worker.

import { Database as Sqlite } from "bun:sqlite";

import type { SqlDriver, Statement, StatementResult } from "../src/database/driver";

/** A fresh, empty in-memory database behind core's driver interface. */
export class BunSqliteDriver implements SqlDriver {
  readonly #sqlite: Sqlite;

  constructor() {
    this.#sqlite = new Sqlite(":memory:", { strict: true });
    // D1 enforces foreign keys; SQLite leaves them off unless asked.
    this.#sqlite.run("PRAGMA foreign_keys = ON");
  }

  async batch(statements: readonly Statement[]): Promise<readonly StatementResult[]> {
    // A real driver answers later, so two callers started together both get past their first step before either finishes.
    await Promise.resolve();

    return this.#sqlite.transaction(() => statements.map((statement) => this.#run(statement)))();
  }

  #run(statement: Statement): StatementResult {
    using prepared = this.#sqlite.prepare(statement.sql);
    if (prepared.columnNames.length > 0) return { rows: prepared.all(...statement.params) as Record<string, unknown>[], changes: 0 };

    return { rows: [], changes: prepared.run(...statement.params).changes };
  }
}
