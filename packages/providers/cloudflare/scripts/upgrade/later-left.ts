// What the later step left on the database of an install that took this commit's build, read through Cloudflare's API once the install answers as that build.
//
//   the marks     core's own reading of the applied steps: every step of the build is marked with the build's fingerprint
//   the schema    the step's table, its column of the sites, and its index over that column
//   the rows      each site from before the update holds what the step filled from it, in the column and in the table; a site published after holds the column's default and no row
//
// The Worker applied the step as it started: the upgrade itself runs no step. No line names a site, an address, or a value a row holds.

import type { SqlDriver } from "@poplin/core/src/database/driver";

import { readStanding, type Step } from "../../../../core/src/migrations/migrate";
import type { LiveSite } from "../../live/records";
import { askDatabase } from "../live/shape";
import type { Run, Stop } from "../live/util";
import { LATER_NAMES, laterLabel, stepLabel } from "./later-step";
import type { Reading } from "./record";

/** The table of the sites, the step's table, and the step's index, each as the schema holds it. */
const MADE = "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE name IN ('sites', ?1, ?2)";

/** What each site holds in the step's column, and its row of the step's table: NULL where it has none. */
const FILLED = `SELECT sites.id, sites.${LATER_NAMES.column} AS held, proof.label, proof.versions FROM sites LEFT JOIN ${LATER_NAMES.table} AS proof ON proof.folder = sites.folder`;

/** What an upgrade knows of the sites it asks the step's rows of. */
interface Asked {
  /** Every step of this commit's build, the later step last. */
  readonly steps: readonly Step[];

  /** The install as it was read before the update, with the sites it held then. */
  readonly before: Reading;

  /** The site that was published after the update. */
  readonly after: LiveSite;
}

/** What the later step left, as an upgrade checks it. */
interface Left {
  /** What is wrong with the marks of the applied steps. */
  readonly marks: readonly string[];

  /** What is wrong with what the step made and filled. */
  readonly made: readonly string[];
}

/** What is wrong with the marks: a database this build would not open, or one that is not at the build's last step. */
async function markFaults(driver: SqlDriver, steps: readonly Step[]): Promise<string[]> {
  const standing = await readStanding(driver, steps);
  if (standing.kind !== "at") return [`this commit's build refuses the database: ${standing.kind === "newer" ? "it holds a step the build does not have" : `step ${stepLabel(standing.step)} was applied by another build`}`];


  return standing.version === steps.length ? [] : [`the database is at step ${stepLabel(standing.version)}, where this commit's build has ${steps.length} steps`];
}

/** What of the step's table, column, and index the schema does not hold. */
async function schemaFaults(driver: SqlDriver): Promise<string[]> {
  const [made] = await driver.batch([{ sql: MADE, params: [LATER_NAMES.table, LATER_NAMES.index] }]);
  const held = new Map(made?.rows.map((row) => [row.name, row]));
  const index = held.get(LATER_NAMES.index);

  return [
    ...(held.get(LATER_NAMES.table)?.type === "table" ? [] : ["the step's table is not there"]),
    ...(String(held.get("sites")?.sql).includes(LATER_NAMES.column) ? [] : ["the step's column is not among those of the sites"]),
    ...(index?.type === "index" && index.tbl_name === "sites" ? [] : ["the step's index is not there, over the sites"]),
  ];
}

/** What is wrong with the rows the step filled: one line a site from before the update, by its place and its access, and one for the site published after it. */
function rowFaults(rows: readonly Readonly<Record<string, unknown>>[], asked: Pick<Asked, "before" | "after">): string[] {
  const filled = new Map(rows.map((row) => [row.id, row]));
  const faults = asked.before.sites.flatMap((site, place) => {
    const row = filled.get(site.shown.id);
    const label = laterLabel({ access: site.access, live_version: site.shown.live_version });
    const versions = Array.isArray(site.shown.versions) ? site.shown.versions.length : undefined;
    const told = [
      ...(row?.held === label ? [] : ["its column does not hold what the step fills it with"]),
      ...(row?.label === label && row.versions === versions ? [] : ["its row of the step's table is not the one the step fills"]),
    ];

    return told.length === 0 ? [] : [`site ${place + 1} (${site.access}): ${told.join(", ")}`];
  });
  const later = filled.get(asked.after.id);

  return later?.held === "" && later.label === null ? faults : [...faults, "the site published after the update does not hold the column's default alone"];
}

/**
 * Read what the later step left on an install's database.
 *
 * @param databaseId - the database the install is bound to
 * @returns what is wrong with the marks and with what the step made, none where all is as the step leaves it; or why Cloudflare did not answer
 */
export function readLeft(run: Run, databaseId: string, asked: Asked): Promise<Left | Stop> {
  return askDatabase(run, databaseId, async (driver) => {
    const marks = await markFaults(driver, asked.steps);
    const schema = await schemaFaults(driver);
    if (schema.length > 0) return { marks, made: schema };

    const [filled] = await driver.batch([{ sql: FILLED, params: [] }]);

    return { marks, made: rowFaults(filled?.rows ?? [], asked) };
  });
}
