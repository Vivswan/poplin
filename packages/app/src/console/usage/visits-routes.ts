// The data of the Usage screen's graph: how often pages were opened over a stretch of days, all sites together and the sites picked beside them.
//
//   GET /usage/visits   ?range= the days read, today the last; ?sites= up to fifty site ids, set apart by commas
//
// A stretch of up to 90 days answers a count a day. A longer one answers a count a week, so a year is 53 points and not 365.

import { vValidator } from "@hono/valibot-validator";
import { readConfig } from "@poplin/core/src/actions/install/config";
import { dayOf, MOST_SITES_COMPARED } from "@poplin/core/src/records/views";
import { parseSiteId, type SiteId } from "@poplin/core/src/sites/ids";
import { Hono } from "hono";
import * as v from "valibot";

import { refused, refuseInvalid, type Shared } from "../data";

/** The stretches of days the graph offers, the shortest first. */
const RANGES = ["30", "60", "90", "180", "365"] as const;

/** What the graph's address may ask for, and nothing else. A site named twice is read once. */
const VISITS_QUERY = v.strictObject({
  range: v.pipe(v.picklist(RANGES), v.transform(Number)),
  sites: v.optional(
    v.pipe(
      v.string(),
      v.transform((text) => [...new Set(text.split(",").filter((id) => id !== ""))]),
      v.array(v.custom<SiteId>((id) => typeof id === "string" && parseSiteId(id).ok)),
      v.maxLength(MOST_SITES_COMPARED),
    ),
    "",
  ),
});

/** The longest stretch answered day by day, in days. */
const MOST_DAILY = 90;

/** One line of the graph: a count for every step, and the sum of every day read. */
interface Line {
  readonly total: number;
  readonly counts: readonly number[];
}

function lineOf(counts: readonly number[]): Line {
  return { total: counts.reduce((total, count) => total + count, 0), counts };
}

/** The graph's data route. `range` is how many days were read, `days` holds the UTC date each step starts on, the earliest first, and `by` says what a step is; a site asked for that is no site any more is left out. */
export const visitsRoutes = new Hono<Shared>().get("/usage/visits", vValidator("query", VISITS_QUERY, refuseInvalid), async (context) => {
  const { install, actor } = context.get("asker");
  const config = await readConfig(install, actor);
  if (!config.ok) return refused(context, config);

  const { range, sites: asked } = context.req.valid("query");
  // A stretch answered week by week is read from the sums of its weeks, so a year costs its 53 weeks and not its 365 days.
  const weekly = range > MOST_DAILY;
  const today = dayOf(install.now());
  const [views, names] = await Promise.all([weekly ? install.database.readWeeklyViews(asked, today, range) : install.database.readDailyViews(asked, today, range), install.database.getSiteNames(asked)]);
  const sites = asked.flatMap((id) => {
    const named = names.get(id);

    return named === undefined ? [] : [{ id, name: named.name, ...lineOf(views.sites.get(id) ?? []) }];
  });

  return context.json({ ok: true as const, range, by: weekly ? ("week" as const) : ("day" as const), days: views.days, all: lineOf(views.all), sites });
});
