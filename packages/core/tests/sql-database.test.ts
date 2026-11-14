import { describeDatabase } from "./database-contract";
import { BunSqliteDriver } from "./bun-sqlite-driver";

describeDatabase("bun:sqlite", () => new BunSqliteDriver());
