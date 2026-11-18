// The later step of a live upgrade: one schema step numbered above every step of the product, which the checkout of the run is given for the upgrade alone.
//
//   live:upgrade-builds   writes it beside the product's steps and lists it in their registry, in the checkout of the run: no commit holds it
//   the build after it    is the product with one step more, so the install that takes it has a step to apply on its real database
//
// It does what a step of a release does: a new table, a new column with a default on a table that holds rows, a new index, and rows filled from what the database held.
// The file is written by the writer core's `draft-step` writes a step with: it holds its statements itself, and STRICT and WITHOUT ROWID are added by hand.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { stepFile, stepFileName } from "../../../core/scripts/step-file";
import type { Step } from "../../../core/src/migrations/migrate";

/** The folder of the product's steps, from the root of a tree. */
const STEPS_FOLDER = join("packages", "core", "src", "migrations");

/** The file that lists every step, in that folder. */
const REGISTRY = "registry.ts";

/** The file of a step: its number, then what it does. */
const STEP_FILE = /^(\d{4})-[a-z0-9-]+\.ts$/;

/** The list of the registry: what stands before its steps, the steps, and what ends it. A list that holds a comment is none the step is added to: a line comment would take the step in. */
const LIST = /(export const STEPS: readonly Step\[\] = \[)([^\]/]*?)(,?\s*\];)/g;

/** The first line of the registry that loads something, which the step's own line goes before. */
const FIRST_IMPORT = /^import /m;

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

/** The number of a step as a line of a run writes it. */
export function stepLabel(number: number): string {
  return String(number).padStart(4, "0");
}

/**
 * The later step, as the step of a number.
 *
 * @param number - the schema version it leaves a database at: one above the product's last step
 */
export function laterStep(number: number): Step {
  return { number, description: DESCRIPTION, statements: STATEMENTS };
}

/** Whether a step is the later step: the one of its number, statement for statement. */
export function isLaterStep(step: Step | undefined): boolean {
  return step !== undefined && step.description === DESCRIPTION && step.statements.join("\n") === STATEMENTS.join("\n");
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
 * Give a tree the later step: its file beside the product's steps, and its line in their registry.
 *
 * @param root - the root of the tree, which is the checkout of a run and never one a commit is made from
 * @returns the step, numbered one above the tree's last
 * @throws {Error} the tree holds the step already, or its registry does not list its steps on one line of the known form
 */
export function addLaterStep(root: string): Step {
  const folder = join(root, STEPS_FOLDER);
  const files = readdirSync(folder).filter((file) => STEP_FILE.test(file));
  const step = laterStep(Math.max(0, ...files.map((file) => Number(STEP_FILE.exec(file)?.[1]))) + 1);
  const name = stepFileName(step);
  if (files.some((file) => file.slice(4) === name.slice(4))) throw new Error(`${STEPS_FOLDER} holds the later step already`);

  const registry = readFileSync(join(folder, REGISTRY), "utf8");
  if (registry.match(LIST)?.length !== 1 || !FIRST_IMPORT.test(registry)) throw new Error(`${REGISTRY} does not list its steps in the form the later step is added to`);

  const listed = registry.replace(LIST, (_all, before: string, steps: string, after: string) => `${before}${steps}, STEP_${step.number}${after}`);
  writeFileSync(join(folder, name), stepFile(step), { flag: "wx" });
  writeFileSync(join(folder, REGISTRY), listed.replace(FIRST_IMPORT, `import { STEP_${step.number} } from "./${name.slice(0, -".ts".length)}";\nimport `));

  return step;
}
