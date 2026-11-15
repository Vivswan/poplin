import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";

import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";

import * as schema from "../../src/database/schema";
import { STEPS } from "../../src/migrations/registry";

/** The text of every check of a table, without what two writers of one check may differ in: spaces, quotes, the case of words, and the table's name before a column. */
function checksOf(created: string, table: string): string[] {
  const checks: string[] = [];

  for (const { index } of created.matchAll(/\bCHECK\s*\(/gi)) {
    const open = created.indexOf("(", index);
    let depth = 0;
    let at = open;

    do {
      if (created[at] === "(") depth += 1;
      if (created[at] === ")") depth -= 1;
      at += 1;
    } while (depth > 0);

    const text = created.slice(open + 1, at - 1).replace(/[\s"`]/g, "").toLowerCase();
    checks.push(text.replaceAll(`${table}.`, "").replaceAll(`__new_${table}.`, ""));
  }

  return checks.sort();
}

/** What SQLite itself says of a database's tables, in a form two databases can be compared by. Names of constraints and the order of statements are left out. */
function shapeOf(sqlite: Sqlite): Record<string, unknown> {
  const names = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_steps' ORDER BY name").all() as { name: string }[];
  const shape: Record<string, unknown> = {};

  for (const { name } of names) {
    const columns = sqlite.prepare(`SELECT name, lower(type) AS type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo('${name}') ORDER BY name`).all();
    const indexes = (sqlite.prepare(`SELECT name, "unique" FROM pragma_index_list('${name}') WHERE origin <> 'pk'`).all() as { name: string; unique: number }[]).map((index) => {
      const keys = sqlite.prepare(`SELECT name, desc FROM pragma_index_xinfo('${index.name}') WHERE key = 1 ORDER BY seqno`).all() as { name: string; desc: number }[];

      return `${index.unique === 1 ? "unique " : ""}${keys.map((key) => `${key.name}${key.desc === 1 ? " desc" : ""}`).join(", ")}`;
    });
    const references = sqlite.prepare(`SELECT "from", "table", "to", on_delete FROM pragma_foreign_key_list('${name}')`).all();
    const created = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string };

    shape[name] = { columns, indexes: indexes.sort(), references, checks: checksOf(created.sql, name) };
  }

  return shape;
}

// Drift: the queries take their columns from the declared schema and the database gets its tables from the steps. A column, an index, or a check in one and not in the other is a query that fails, or is slow, only when it runs.
test("the steps build the tables that are declared: the same columns, defaults, keys, indexes, references, and checks", async () => {
  const built = new Sqlite(":memory:", { strict: true });
  for (const step of STEPS) for (const statement of step.statements) built.run(statement);

  const declared = new Sqlite(":memory:", { strict: true });
  for (const statement of await generateSQLiteMigration(await generateSQLiteDrizzleJson({}), await generateSQLiteDrizzleJson(schema))) declared.run(statement);

  expect(shapeOf(built)).toEqual(shapeOf(declared));
});
