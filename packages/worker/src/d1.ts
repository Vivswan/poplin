// Core's SQL driver on a D1 database binding.

import type { SqlDriver, Statement, StatementResult } from "@poplin/core/src/database/driver";

/** A D1 database behind core's driver interface. D1 enforces foreign keys and runs a batch as one transaction. */
export class D1Driver implements SqlDriver {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async batch(statements: readonly Statement[]): Promise<readonly StatementResult[]> {
    const prepared = statements.map((statement) => this.#database.prepare(statement.sql).bind(...statement.params));
    const results = await this.#database.batch<Record<string, unknown>>(prepared);

    return results.map((result) => ({ rows: result.results, changes: result.meta.changes }));
  }
}
