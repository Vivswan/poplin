// What the whole install holds in sites, bytes, and files, and the one place the row of it becomes that value.

import * as v from "valibot";

import { COUNT } from "./fields";

/** The row of the totals table. */
const TOTALS_ROW = v.object({ sites: COUNT, trashed_sites: COUNT, bytes: COUNT, files: COUNT });

/**
 * What the whole install holds.
 *
 * `sites` counts every site and `trashed_sites` those of them in the trash. `bytes` and `files` sum every kept version of every site, the trash included: a trashed site's files are still in the bucket.
 */
export type Totals = Readonly<v.InferOutput<typeof TOTALS_ROW>>;

/**
 * Turn the row of the totals table into the totals.
 *
 * @throws {Error} the row is no totals row
 */
export function totalsFromRow(row: unknown): Totals {
  return v.parse(TOTALS_ROW, row);
}
