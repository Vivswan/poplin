// SQLite's WebAssembly module, loaded once for every test of the browser host from the file the build ships.

import type { SqlJsStatic } from "sql.js";

import { loadSqlite } from "../../../src/browser/sqljs-driver";

/** The WebAssembly file of the installed sql.js. */
const WASM = Bun.fileURLToPath(import.meta.resolve("sql.js/dist/sql-wasm-browser.wasm"));

/** The module, loaded when this file is. */
export const SQLITE: SqlJsStatic = await loadSqlite(await Bun.file(WASM).arrayBuffer());
