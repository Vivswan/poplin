// The install's database behind the fake API's query route: SQLite in memory at core's own schema, asked the way D1's API is asked.
//
//   one call    several statements joined by semicolons, one list of values numbered over the whole call, one transaction
//   a number    bound as a real one, as D1's API binds it
//   the answer  one result a statement, each with its rows and how many rows it changed

import type { Login } from "@poplin/core/src/auth/logins";
import type { Database } from "@poplin/core/src/database/database";
import type { SqlValue, Statement } from "@poplin/core/src/database/driver";
import { openDatabase } from "@poplin/core/src/database/open";
import { SqlDatabase } from "@poplin/core/src/database/sql-database";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { BunSqliteDriver } from "@poplin/core/tests/database/support/bun-sqlite-driver";

/** A quoted text or name, which is passed over, the end of a statement, or a numbered placeholder. */
const QUOTED_END_OR_PLACEHOLDER = /'(?:[^']|'')*'|"(?:[^"]|"")*"|;|\?(\d+)/g;

/** One statement's result, as the query route answers it. */
interface Answered {
  readonly results: readonly unknown[];
  readonly success: boolean;
  readonly meta: { readonly changes: number };
}

/** A database of an install, and the two ways to it: the query route's, and core's own for a test to seed it and to read it back. */
export interface Store {
  /** Answers one call of the query route: `sql` is one statement or several joined by semicolons, and `params` the values of `?1`, `?2`, ... over the whole call. It rejects for a statement that fails, and keeps nothing of the call then. */
  readonly call: (sql: string, params: readonly SqlValue[]) => Promise<Answered[]>;

  /** The same database as core's own store has it. */
  readonly database: Database;
}

/** The statements of a call, each with the values its placeholders name: a number is cast to a real one, and the placeholders are numbered anew from 1. */
function statementsOf(sql: string, params: readonly SqlValue[]): Statement[] {
  const statements: Statement[] = [];
  let [text, values, from]: [string, SqlValue[], number] = ["", [], 0];
  const close = (upTo: number): void => {
    text += sql.slice(from, upTo);
    if (text.trim() !== "") statements.push({ sql: text, params: values });

    [text, values] = ["", []];
  };

  for (const found of sql.matchAll(QUOTED_END_OR_PLACEHOLDER)) {
    const [whole, digits] = found;
    if (whole === ";") {
      close(found.index);
      from = found.index + 1;
    }

    if (digits === undefined) continue;

    const value = params[Number(digits) - 1] ?? null;
    values.push(value);
    text += `${sql.slice(from, found.index)}${typeof value === "number" ? `CAST(?${values.length} AS REAL)` : `?${values.length}`}`;
    from = found.index + whole.length;
  }

  close(sql.length);

  return statements;
}

/**
 * Make the database of an install.
 *
 * @param first - the first login of an install that has stored its settings; `undefined` for a database no step has run on, as a Worker that never answered leaves it
 */
export async function storeOf(first: Login | undefined): Promise<Store> {
  const driver = new BunSqliteDriver();
  const call: Store["call"] = async (sql, params) => (await driver.batch(statementsOf(sql, params))).map(({ rows, changes }) => ({ results: rows, success: true, meta: { changes } }));
  if (first === undefined) return { call, database: new SqlDatabase(driver) };

  const opened = await openDatabase(driver, 0);
  if (opened.kind !== "open") throw new Error(`the test's database did not open: ${opened.kind}`);

  await opened.database.initSettings(defaultSettings({ installer: first }), { as: "first_login", by: first, at: 0 });

  return { call, database: opened.database };
}
