import { BunSqliteDriver } from "./bun-sqlite-driver";
import { describeDatabase } from "./database-contract";
import { describeSqlDriver, sqlDatabaseOver } from "./sql-driver-contract";

describeDatabase("bun:sqlite", sqlDatabaseOver(() => new BunSqliteDriver()));
describeSqlDriver("bun:sqlite", () => new BunSqliteDriver());
