// What the database holds in bytes and files, for one site and for the whole install, and the one place a row of either becomes that value.

import * as v from "valibot";

import { COUNT } from "./fields";

/** The sums over the kept versions of one site; `versions` is 0 exactly when there is no such site. */
const SIZE_ROW = v.object({ bytes: COUNT, files: COUNT, versions: COUNT });

/** The row of the totals table. */
const TOTALS_ROW = v.object({ sites: COUNT, trashed_sites: COUNT, bytes: COUNT, files: COUNT });

/** What the kept versions of one site hold together: the sum of their files' sizes, and how many files that is. */
export type SiteSize = { readonly bytes: number; readonly files: number };

/**
 * What the whole install holds.
 *
 * `sites` counts every site and `trashed_sites` those of them in the trash. `bytes` and `files` sum every kept version of every site, the trash included: a trashed site's files are still in the bucket.
 */
export type Totals = Readonly<v.InferOutput<typeof TOTALS_ROW>>;

/**
 * Turn the sums over a site's versions into its size.
 *
 * @returns `undefined` when the sums cover no version, which is a site that does not exist
 * @throws {Error} the row is no such sum
 */
export function sizeFromRow(row: unknown): SiteSize | undefined {
  const { bytes, files, versions } = v.parse(SIZE_ROW, row);
  if (versions === 0) return undefined;

  return { bytes, files };
}

/**
 * Turn the row of the totals table into the totals.
 *
 * @throws {Error} the row is no totals row
 */
export function totalsFromRow(row: unknown): Totals {
  return v.parse(TOTALS_ROW, row);
}
