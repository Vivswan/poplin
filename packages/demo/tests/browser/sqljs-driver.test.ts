import { expect, test } from "bun:test";

import { describeDatabase } from "../../../core/tests/database/support/database-contract";
import { describeSqlDriver, sqlDatabaseOver } from "../../../core/tests/database/support/sql-driver-contract";
import { SqlJsDriver } from "../../src/browser/sqljs-driver";
import { SQLITE } from "./support/sqlite";

describeDatabase(
  "sql.js",
  sqlDatabaseOver(() => new SqlJsDriver(SQLITE)),
);
describeSqlDriver("sql.js", () => new SqlJsDriver(SQLITE));

test("a saved database opens again with its rows, and both go on enforcing foreign keys: without this a demo that was stopped comes back empty, or takes rows the product's schema forbids", async () => {
  const first = new SqlJsDriver(SQLITE);
  await first.batch([
    { sql: "CREATE TABLE owners (id INTEGER PRIMARY KEY)", params: [] },
    { sql: "CREATE TABLE sites (name TEXT, owner INTEGER REFERENCES owners (id))", params: [] },
    { sql: "INSERT INTO owners VALUES (?1)", params: [1] },
    { sql: "INSERT INTO sites VALUES (?1, ?2)", params: ["handbook", 1] },
  ]);
  const second = new SqlJsDriver(SQLITE, first.save());
  const orphan = { sql: "INSERT INTO sites VALUES (?1, ?2)", params: ["stray", 2] };
  const [read] = await second.batch([{ sql: "SELECT name, owner FROM sites", params: [] }]);

  expect(read?.rows).toEqual([{ name: "handbook", owner: 1 }]);
  await expect(first.batch([orphan])).rejects.toThrow("FOREIGN KEY");
  await expect(second.batch([orphan])).rejects.toThrow("FOREIGN KEY");
});
