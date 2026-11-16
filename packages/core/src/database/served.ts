// What a version is known to hold, as the versions table keeps it: the values a new version is stored with, and the one place a row becomes a served site.

import * as v from "valibot";

import { POSITIVE } from "../records/fields";
import { type Site, siteFromRow } from "../records/site";
import { UNKNOWN_CONTENTS, type VersionContents } from "../records/version-contents";
import type { ServedSite } from "./database";
import type { StatementResult } from "./driver";

/** The live version of a served site as a lookup for serving reads it: the one version of its list, with what it holds as stored. */
const LIVE_WITH_CONTENTS = v.pipe(v.string(), v.parseJson(), v.tuple([v.object({ number: POSITIVE, missing_page: v.picklist([0, 1]), bare_files: v.nullable(v.string()) })]));

/** The two values what a version holds is stored as, in the order `missing_page`, `bare_files`; those of a version nothing is known of when left out. */
export function contentsValues(contents: VersionContents = UNKNOWN_CONTENTS): [missingPage: number, bareFiles: string | null] {
  return [contents.missing_page ? 1 : 0, contents.bare_files];
}

/** The versions of a backup's site as the JSON list they are inserted from, each with what `contents` says it holds. */
export function versionsWithContents(versions: Site["versions"], contents: ReadonlyMap<number, VersionContents>): string {
  return JSON.stringify(
    versions.map((version) => {
      const [missing_page, bare_files] = contentsValues(contents.get(version.number));

      return { ...version, missing_page, bare_files };
    }),
  );
}

/**
 * Read the site a lookup for serving found, with what its live version holds.
 *
 * @param result - the answer to a lookup of a site with its live version alone, which carries what it holds
 * @returns the site, its `versions` holding the live one alone
 * @throws {Error} the row is no site, or its version does not say what it holds
 */
export function servedIn(result: StatementResult | undefined): ServedSite | undefined {
  const row = result?.rows[0];
  if (row === undefined) return undefined;

  const [live] = v.parse(LIVE_WITH_CONTENTS, row.versions);

  return { site: siteFromRow(row), contents: { missing_page: live.missing_page === 1, bare_files: live.bare_files } };
}
