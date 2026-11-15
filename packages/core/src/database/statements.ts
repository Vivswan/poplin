// How a statement is built from the schema `schema.ts` declares and handed to the driver: the builder every statement starts from, and the small parts many statements share.

import { getTableName, type SQL, sql as fragment } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";

import type { SqlValue, Statement } from "./driver";

/** Where statements are built from the declared schema. None is run here: each goes to the driver, in a batch. */
export const BUILD = drizzle(() => Promise.reject(new Error("a statement is run by the driver, in a batch")));

/** True when the statement before it in the batch changed one row. */
export const CHANGED = fragment`changes() = 1`;

/** A row that stands for "there is one" in a subquery. */
export const ONE = { one: fragment`1` };

/** What the builder gives for one statement. */
interface BuiltQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * A column with its table's name before it.
 * A built statement that reads one table writes its selected columns bare, and a subquery inside the selection would read a bare column as its own.
 */
export function qualified(column: SQLiteColumn): SQL {
  return fragment`${fragment.identifier(getTableName(column.table))}.${fragment.identifier(column.name)}`;
}

/** A column by its name alone, as the column list of an `INSERT` takes it. */
export function bare(column: SQLiteColumn): SQL {
  return fragment`${fragment.identifier(column.name)}`;
}

/** A built statement as the driver takes it. */
export function built(query: { toSQL(): BuiltQuery } | { getQuery(): BuiltQuery }): Statement {
  const { sql: text, params } = "toSQL" in query ? query.toSQL() : query.getQuery();

  return { sql: text, params: params as SqlValue[] };
}

/** A statement written with the template, for what the builder has no word for. */
export function written(text: SQL): Statement {
  return built(BUILD.all(text));
}

/**
 * An `INSERT` of the columns named, from a `SELECT`.
 * The insert builder names every column of a table, and a key the engine would give costs one row read more when it is named.
 */
export function insertFrom(table: SQLiteTable, columns: readonly SQLiteColumn[], select: SQL): Statement {
  return written(fragment`INSERT INTO ${table} (${fragment.join(columns.map(bare), fragment`, `)}) ${select}`);
}
