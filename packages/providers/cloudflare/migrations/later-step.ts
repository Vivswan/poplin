// The later step of a live upgrade: one schema step after every step of the product, which the checkout of the run is given for the upgrade alone.
//
//   live:upgrade-builds   adds it to the file of the older build's version among the product's steps, in the checkout of the run: no commit holds it
//   the build after it    is the product with one step more, so the install that takes it has a step to apply on its real database
//
// It does what a step of a release does: a new table, a new column with a default on a table that holds rows, a new index, and rows filled from what the database held.
// It is added by the writer core's `draft-step` adds a step with: it holds its statements itself, and STRICT and WITHOUT ROWID are added by hand.

import { join } from "node:path";

import { addStep } from "../../../core/scripts/step-file";
import type { Step } from "../../../core/src/migrations/migrate";

/** The folder of the product's steps, from the root of a tree. */
const STEPS_FOLDER = join("packages", "core", "src", "migrations");

/** What the step is called in the file of its version. */
const NAME = "upgrade-proof";

/** What the step changes, in a few words. */
const DESCRIPTION = "add the upgrade proof";

/** What the step makes: a table, a column of the sites, and an index over that column. */
export const LATER_NAMES = { table: "upgrade_proof", column: "upgrade_label", index: "sites_by_upgrade_label" } as const;

/** The statements of the step, in order: the table, the column with its default, the column filled from what each site held, the index, and one row of the table for each site with the count of its versions. */
const STATEMENTS: readonly string[] = [
  `CREATE TABLE ${LATER_NAMES.table} (folder TEXT NOT NULL PRIMARY KEY REFERENCES sites (folder) ON DELETE CASCADE, label TEXT NOT NULL, versions INTEGER NOT NULL CHECK (versions >= 1)) STRICT, WITHOUT ROWID`,
  `ALTER TABLE sites ADD COLUMN ${LATER_NAMES.column} TEXT NOT NULL DEFAULT ''`,
  `UPDATE sites SET ${LATER_NAMES.column} = access || '/' || live_version`,
  `CREATE INDEX ${LATER_NAMES.index} ON sites (${LATER_NAMES.column}, id)`,
  `INSERT INTO ${LATER_NAMES.table} (folder, label, versions) SELECT folder, ${LATER_NAMES.column}, (SELECT count(*) FROM versions WHERE versions.folder = sites.folder) FROM sites`,
];

/** The rows the step costs an upgrade, as the provider's database counts them: 5 as it runs and 3 more for each site; then, past the price of any request, 2 as each of those sites is removed and 2 for the site published after it. */
const ROWS = { once: 5, eachSite: 3, eachRemoval: 2, siteAfter: 2 } as const;

/**
 * The later step, as a step of a version.
 *
 * @param version - the release it migrates away from: the one the older build says
 */
export function laterStep(version: string): Step {
  return { version, name: NAME, description: DESCRIPTION, statements: STATEMENTS };
}

/** Whether a step is the later step: the one of its name, statement for statement. */
export function isLaterStep(step: Step | undefined): boolean {
  return step !== undefined && step.name === NAME && step.statements.join("\n") === STATEMENTS.join("\n");
}

/**
 * Say what a site holds in the step's column once the step ran: what the step read of it.
 *
 * @param site - who may open the site, and the version it shows
 */
export function laterLabel(site: { readonly access: string; readonly live_version: unknown }): string {
  return `${site.access}/${String(site.live_version)}`;
}

/**
 * Say how many rows the step costs an upgrade that removes every site again: the rows it writes as it runs, and the rows its index and its table add to the requests after it.
 *
 * @param sites - how many sites the database held when the step ran
 */
export function laterRows(sites: number): number {
  return ROWS.once + (ROWS.eachSite + ROWS.eachRemoval) * sites + ROWS.siteAfter;
}

/**
 * Give a tree the later step: the last step of the file of a version among the product's steps, which is made and listed in their registry where the tree has none.
 *
 * @param root - the root of the tree, which is the checkout of a run and never one a commit is made from
 * @param version - the version the older build says, which the step migrates away from
 * @returns the step
 * @throws {Error} the tree holds the step already, or its steps are not in the form a step is added to
 */
export function addLaterStep(root: string, version: string): Step {
  addStep(join(root, STEPS_FOLDER), version, { name: NAME, description: DESCRIPTION, statements: STATEMENTS });

  return laterStep(version);
}
