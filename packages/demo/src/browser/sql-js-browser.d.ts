// The build of sql.js for a browser ships no types of its own: it is the same module as the package's main entry, which `@types/sql.js` describes.

declare module "sql.js/dist/sql-wasm-browser.js" {
  import initSqlJs = require("sql.js");

  export = initSqlJs;
}
