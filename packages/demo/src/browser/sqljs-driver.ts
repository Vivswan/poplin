// Core's SQL driver on SQLite compiled to WebAssembly (sql.js), in memory: the SQL the product sends its database runs here, inside a browser.

import type { SqlValue as BoundValue, Database, SqlJsStatic } from "sql.js";
// The build of sql.js for a browser, named outright: a test under another runtime then runs the very file the worker ships.
import initSqlJs from "sql.js/dist/sql-wasm-browser.js";

import type { SqlDriver, Statement, StatementResult } from "../../../core/src/database/driver";

/** SQLite leaves foreign keys off unless asked, and forgets the answer whenever the database is opened again. */
const ENFORCE_FOREIGN_KEYS = "PRAGMA foreign_keys = ON";

/**
 * Load SQLite from the bytes of its WebAssembly file.
 *
 * @param wasm - the bytes of sql.js's `sql-wasm-browser.wasm`, which the host read or fetched
 * @returns the module every `SqlJsDriver` of this host opens its database in
 */
export function loadSqlite(wasm: ArrayBuffer): Promise<SqlJsStatic> {
  return initSqlJs({ wasmBinary: wasm });
}

/** One in-memory database behind core's driver interface, whose whole content `save` hands out as a SQLite file. */
export class SqlJsDriver implements SqlDriver {
  readonly #sqlite: Database;

  /**
   * @param sqlite - the loaded module
   * @param saved - the file of a database `save` handed out earlier; an empty database when left out
   */
  constructor(sqlite: SqlJsStatic, saved?: Uint8Array) {
    this.#sqlite = new sqlite.Database(saved);
    this.#sqlite.run(ENFORCE_FOREIGN_KEYS);
  }

  async batch(statements: readonly Statement[]): Promise<readonly StatementResult[]> {
    // A real driver answers later, so two callers started together both get past their first step before either finishes.
    await Promise.resolve();
    this.#sqlite.run("BEGIN");

    try {
      const results = statements.map((statement) => this.#run(statement));
      this.#sqlite.run("COMMIT");

      return results;
    } catch (error) {
      this.#sqlite.run("ROLLBACK");

      throw error;
    }
  }

  /**
   * Hand out the database as it is now.
   *
   * @returns the bytes of one SQLite file, which a later driver opens as `saved`
   */
  save(): Uint8Array {
    const file = this.#sqlite.export();
    // An export opens the database again.
    this.#sqlite.run(ENFORCE_FOREIGN_KEYS);

    return file;
  }

  /** Give the database's memory back. Nothing can be asked of it afterwards. */
  close(): void {
    this.#sqlite.close();
  }

  #run(statement: Statement): StatementResult {
    const prepared = this.#sqlite.prepare(statement.sql);

    try {
      prepared.bind(statement.params as BoundValue[]);

      if (prepared.getColumnNames().length === 0) {
        prepared.step();

        return { rows: [], changes: this.#sqlite.getRowsModified() };
      }

      const rows: Record<string, unknown>[] = [];
      while (prepared.step()) rows.push(prepared.getAsObject());

      return { rows, changes: 0 };
    } finally {
      prepared.free();
    }
  }
}
