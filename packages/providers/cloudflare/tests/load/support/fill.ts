// Fills an install with the bulk of a load run, a statement a table: so many sites, each with its versions, a log, users, and tokens. Three sites are the ones the requests are about.
//
//   site 1   public under the name `load`, its live version holding the fill's files in the bucket
//   site 2   unlisted, one page
//   site 3   private, one page

import { parseLogins } from "@poplin/core/src/auth/logins";
import type { Fill } from "../../../load/profiles";
import { manyEntries, manyFiles, manySites, manyTokens, siteFolder, siteId } from "../../shared/worker/support/budget-seeds";
import { sql, type Stage } from "../../shared/worker/support/budget-stage";
import { OWNER } from "../../shared/worker/support/install";

/** The public name of site 1. */
const PUBLIC_NAME = "load";

/** The sites a graph of visits compares at the most, and the days it reads at the most. */
const GRAPH = { sites: 50, days: 365 } as const;

/** Where the three sites of a fill answer, on the example domain of the Worker's tests. */
export const FILLED = {
  public: `https://${PUBLIC_NAME}-page.example.com`,
  unlisted: `https://site-2--${siteId(2)}-u-poplin.example.com`,
  private: `https://site-3--${siteId(3)}-p-poplin.example.com`,
} as const;

/** How a data route of the dashboard names a made-up site. */
export function labelOf(n: number): string {
  return `site-${n}--${siteId(n)}`;
}

/** Let so many users log in, the owner first. */
async function manyUsers(stage: Stage, count: number): Promise<void> {
  const logins = parseLogins([OWNER, ...Array.from({ length: count - 1 }, (_user, at) => `user-${at + 1}@example.com`)]);
  if (!logins.ok) throw new Error("a made-up login is no email address");

  await stage.install.database.changeSettings({ logins: [...logins.value] }, { as: "person", by: OWNER, at: stage.w.clock.now });
}

/**
 * Fill the stage's install.
 *
 * @param fill - how much of each thing; fewer than three sites are filled as three
 */
export async function fillInstall(stage: Stage, fill: Fill): Promise<void> {
  await manySites(stage, Math.max(3, fill.sites), { versions: fill.versions });
  await sql("UPDATE sites SET access = 'public', public_name = ?2 WHERE id = ?1", siteId(1), PUBLIC_NAME);
  await sql("UPDATE sites SET access = 'unlisted' WHERE id = ?1", siteId(2));
  await sql("UPDATE versions SET files = ?2, bytes = ?2 WHERE folder = ?1 AND number = 1", siteFolder(1), fill.files);
  await manyFiles(`${siteFolder(1)}/v1/`, fill.files);
  await manyFiles(`${siteFolder(2)}/v1/`, 1);
  await manyFiles(`${siteFolder(3)}/v1/`, 1);
  await manyEntries(stage, fill.entries, Math.max(3, fill.sites));
  await manyTokens(stage, fill.tokens);
  await manyUsers(stage, fill.users);
}

/** Count nine requests on each of the last 365 days for the first sites of a fill, fifty at the most, and for all sites together: the most a graph of visits reads. */
export async function yearOfVisits(stage: Stage, fill: Fill): Promise<readonly string[]> {
  const sites = Math.min(GRAPH.sites, fill.sites);
  await sql(
    `WITH RECURSIVE days(d) AS (SELECT 0 UNION ALL SELECT d + 1 FROM days WHERE d < ?1 - 1), counted(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM counted WHERE n < ?2)
     INSERT INTO request_counts (day, site, requests, views) SELECT date(?3 / 1000, 'unixepoch', '-' || d || ' days'), CASE n WHEN 0 THEN '' ELSE printf('%012d', n) END, 9, 3 FROM days, counted`,
    GRAPH.days,
    sites,
    stage.w.clock.now,
  );

  return Array.from({ length: sites }, (_site, at) => siteId(at + 1));
}
