// The statements that keep and read the sums of page views: what a graph of many weeks is read from, so its cost goes by the weeks and not by the days.
//
//   request_counts   a day's count of a site, written as the day goes: read day by day
//   view_sums        the same count once its day is over, with the views of every day before it: a stretch of days is the difference of two rows

import { type SQL, sql as fragment } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import { COUNT } from "../records/fields";
import { type CountedViews, dayOf } from "../records/views";
import type { SiteId } from "../sites/ids";
import type { Statement, StatementResult } from "./driver";
import { earlierIds, requestCounts, sites, viewSums } from "./schema";
import { written } from "./statements";

/** The site column of the row that counts all sites together; no site id is empty. */
export const ALL_SITES = "";

/** How long after a UTC day ends its counts are summed: a count is written moments after its request, and never an hour after. */
const SETTLED_MS = 3_600_000;

/** The `request_counts` table as `c`, for the counts a statement sums or reads day by day. */
const A_COUNT = alias(requestCounts, "c");

/** The `view_sums` table as `u`, for the sum a statement looks up. */
const A_SUM = alias(viewSums, "u");

/** The last day whose counts are summed: the newest one of all sites together, and a text before every day while none is. */
const LAST_SUMMED = fragment`coalesce((SELECT max(${A_SUM.day}) FROM ${viewSums} AS ${A_SUM} WHERE ${A_SUM.site} = ${ALL_SITES}), '')`;

/** What the read of the sums answers for one site: the views before the stretch, `null` where no day of the stretch is summed, and the views up to the end of each week as JSON text, `null` where no day up to there is. */
const SUMMED = v.object({ site: v.string(), before: v.nullable(COUNT), upto: v.pipe(v.string(), v.parseJson(), v.array(v.nullable(COUNT))) });

/** One count of a site on a day, as a read of days answers it. */
const DAY_COUNT = v.object({ day: v.string(), site: v.string(), views: COUNT });

/**
 * Build the statement that sums the days that are over and not summed yet: every count of a view on them, and each day's count of all sites together, gets its row with the views of every day before it.
 * A day is summed once, an hour after it ended at the earliest, so a run with no such day reads one row and writes none.
 */
export function viewsSummed(now: number): Statement {
  const before = fragment`coalesce((SELECT ${A_SUM.earlier} + ${A_SUM.views} FROM ${viewSums} AS ${A_SUM} WHERE ${A_SUM.site} = ${A_COUNT.site} ORDER BY ${A_SUM.day} DESC LIMIT 1), 0)`;
  const earlier = fragment`${before} + sum(${A_COUNT.views}) OVER (PARTITION BY ${A_COUNT.site} ORDER BY ${A_COUNT.day}) - ${A_COUNT.views}`;
  const open = fragment`${A_COUNT.day} > ${LAST_SUMMED} AND ${A_COUNT.day} < ${dayOf(now - SETTLED_MS)} AND (${A_COUNT.views} > 0 OR ${A_COUNT.site} = ${ALL_SITES})`;

  return written(fragment`INSERT INTO ${viewSums} (site, day, views, earlier) SELECT ${A_COUNT.site}, ${A_COUNT.day}, ${A_COUNT.views}, ${earlier} FROM ${requestCounts} AS ${A_COUNT} WHERE ${open}`);
}

/** Build the statement that drops the sums of the days before a day, each found by the count it was summed from: it goes before the statement that drops those counts. */
export function sumsDroppedBefore(day: string): Statement {
  return written(fragment`DELETE FROM ${viewSums} WHERE (site, day) IN (SELECT ${A_COUNT.site}, ${A_COUNT.day} FROM ${requestCounts} AS ${A_COUNT} WHERE ${A_COUNT.day} < ${day})`);
}

/**
 * Build the statement that moves the sums of a site to the id it was just given, from a day on: the days its counts move with it, so each sum stays beside the count it is dropped with.
 * It moves them only when the site under the new id gave the old one up, which the kept earlier id says: nothing else is read where no id was given.
 */
export function sumsMoved(id: SiteId, next: SiteId, from: string): Statement {
  const given = fragment`SELECT 1 FROM ${earlierIds} JOIN ${sites} ON ${sites.folder} = ${earlierIds.folder} WHERE ${earlierIds.id} = ${id} AND ${sites.id} = ${next}`;

  return written(fragment`UPDATE ${viewSums} SET site = ${next} WHERE site = (SELECT ${id} WHERE EXISTS (${given})) AND day >= ${from}`);
}

/** The newest sum of a site up to a day, as a subquery of a statement that names the site `s.value`: one row found by its key. */
function sumUpTo(day: string): SQL {
  return fragment`(SELECT ${A_SUM.earlier} + ${A_SUM.views} FROM ${viewSums} AS ${A_SUM} WHERE ${A_SUM.site} = s.value AND ${A_SUM.day} <= ${day} ORDER BY ${A_SUM.day} DESC LIMIT 1)`;
}

/** The sites a read names, as the rows of a statement: `s.value` is each one's id. */
function namedSites(sites: readonly string[]): SQL {
  return fragment`json_each(${JSON.stringify(sites)}) AS s`;
}

/**
 * Build the statement that reads the counts of the days of a stretch that are not summed yet, each found by its key.
 * The days are walked from the last one summed on, so the statement costs the days still open and not the stretch's length. The joins are taken in the order written: each count is then one row.
 */
function openDaysAsked(sites: readonly string[], first: string, last: string): Statement {
  const days = fragment`WITH RECURSIVE open(day) AS (SELECT coalesce(max(${first}, date(${LAST_SUMMED}, '+1 day')), ${first}) UNION ALL SELECT date(day, '+1 day') FROM open WHERE day < ${last})`;
  const counted = fragment`FROM open CROSS JOIN ${namedSites(sites)} CROSS JOIN ${requestCounts} AS ${A_COUNT} WHERE open.day <= ${last} AND ${A_COUNT.day} = open.day AND ${A_COUNT.site} = s.value`;

  return written(fragment`${days} SELECT ${A_COUNT.day} AS day, ${A_COUNT.site} AS site, ${A_COUNT.views} AS views ${counted}`);
}

/** Add each count a statement read to the step its day falls in; a day outside every step, or a site not asked for, adds nothing. */
function addCounts(counts: ReadonlyMap<string, number[]>, read: StatementResult | undefined, stepOf: ReadonlyMap<string, number>): void {
  for (const row of read?.rows ?? []) {
    const { day, site, views } = v.parse(DAY_COUNT, row);
    const step = stepOf.get(day);
    const ofSite = counts.get(site);
    if (step !== undefined && ofSite !== undefined) ofSite[step] = (ofSite[step] ?? 0) + views;
  }
}

/** The counts a read answers, from the counts of each site by its id. */
function viewsOf(days: readonly string[], sites: readonly SiteId[], counts: ReadonlyMap<string, number[]>): CountedViews {
  return { days, all: counts.get(ALL_SITES) ?? [], sites: new Map(sites.map((site) => [site, counts.get(site) ?? []])) };
}

/**
 * Build the two statements a read of views day by day takes: the summed days of each site, read in one stretch a site, and the counts of the days not summed yet.
 *
 * @param sites - the sites read, all sites together among them
 * @param days - the days read, the earliest first
 */
export function dailyViewsAsked(sites: readonly string[], days: readonly string[]): readonly [sums: Statement, open: Statement] {
  const [first, last] = [days[0] ?? "", days.at(-1) ?? ""];
  const summed = fragment`FROM ${namedSites(sites)} CROSS JOIN ${viewSums} AS ${A_SUM} WHERE ${A_SUM.site} = s.value AND ${A_SUM.day} >= ${first} AND ${A_SUM.day} <= ${last}`;

  return [written(fragment`SELECT ${A_SUM.day} AS day, ${A_SUM.site} AS site, ${A_SUM.views} AS views ${summed}`), openDaysAsked(sites, first, last)];
}

/**
 * Read what the two statements of `dailyViewsAsked` answered as the views of each day.
 *
 * @param sites - the sites asked for, without all sites together
 */
export function dailyViewsIn(read: readonly (StatementResult | undefined)[], sites: readonly SiteId[], days: readonly string[]): CountedViews {
  const counts = new Map<string, number[]>([ALL_SITES, ...sites].map((site) => [site, days.map(() => 0)]));
  const place = new Map(days.map((day, at) => [day, at]));
  addCounts(counts, read[0], place);
  addCounts(counts, read[1], place);

  return viewsOf(days, sites, counts);
}

/**
 * Build the two statements a read of views week by week takes: the sums, one row a site with one lookup a week, and the counts of the days not summed yet.
 *
 * @param sites - the sites read, all sites together among them
 * @param weeks - the days of each week, as `weeksUpTo` gives them
 */
export function weeklyViewsAsked(sites: readonly string[], weeks: readonly (readonly string[])[]): readonly [sums: Statement, open: Statement] {
  const [first, last] = [weeks[0]?.[0] ?? "", weeks.at(-1)?.at(-1) ?? ""];
  const before = fragment`(SELECT ${A_SUM.earlier} FROM ${viewSums} AS ${A_SUM} WHERE ${A_SUM.site} = s.value AND ${A_SUM.day} >= ${first} AND ${A_SUM.day} <= ${last} ORDER BY ${A_SUM.day} LIMIT 1)`;
  const upto = fragment.join(
    weeks.map((week) => sumUpTo(week.at(-1) ?? last)),
    fragment`, `,
  );

  return [written(fragment`SELECT s.value AS site, ${before} AS before, json_array(${upto}) AS upto FROM ${namedSites(sites)}`), openDaysAsked(sites, first, last)];
}

/**
 * Read what the two statements of `weeklyViewsAsked` answered as the views of each week.
 *
 * @param sites - the sites asked for, without all sites together
 * @param weeks - the days of each week, as the statements were built from
 */
export function weeklyViewsIn(read: readonly (StatementResult | undefined)[], sites: readonly SiteId[], weeks: readonly (readonly string[])[]): CountedViews {
  const counts = new Map<string, number[]>([ALL_SITES, ...sites].map((site) => [site, weeks.map(() => 0)]));

  for (const row of read[0]?.rows ?? []) {
    const { site, before, upto } = v.parse(SUMMED, row);
    // With no summed day inside the stretch every week stays at 0: what a lookup then finds is a day before the stretch.
    if (before === null) continue;

    // A week with no summed day up to its end stands where the stretch began.
    const reached = upto.map((sum) => sum ?? before);
    counts.set(
      site,
      reached.map((sum, at) => sum - (reached[at - 1] ?? before)),
    );
  }

  addCounts(counts, read[1], new Map(weeks.flatMap((week, at) => week.map((day) => [day, at] as const))));

  return viewsOf(
    weeks.map((week) => week[0] ?? ""),
    sites,
    counts,
  );
}
