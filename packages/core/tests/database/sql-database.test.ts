import { BunSqliteDriver } from "./support/bun-sqlite-driver";
import { describeDatabase } from "./support/database-contract";
import { describeSqlDriver, sqlDatabaseOver } from "./support/sql-driver-contract";

describeDatabase("bun:sqlite", sqlDatabaseOver(() => new BunSqliteDriver()));
describeSqlDriver("bun:sqlite", () => new BunSqliteDriver());
