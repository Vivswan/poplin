// A site's views are sums of sampled counts over seven UTC days: whatever is counted, a site is never shown more views than were counted for it, and never a negative or a fractional number.
// The counts are written as a clock would write them: the day only moves on, across a month's and a year's end.

import { expect } from "bun:test";
import fc from "fast-check";

import { openDatabase } from "../../packages/core/src/database/open";
import { dayOf, viewDays } from "../../packages/core/src/records/views";
import { parseSiteId, type SiteId } from "../../packages/core/src/sites/ids";
import { BunSqliteDriver } from "../../packages/core/tests/database/support/bun-sqlite-driver";
import { fuzzTarget } from "./config";

const FIRST_DAY = Date.UTC(2026, 11, 25);
const DAY = 86_400_000;

const SITES = ["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"] as SiteId[];

const property = fuzzTarget(import.meta.file);

const sites = fc
  .constantFrom(...SITES)
  .map((raw) => parseSiteId(raw))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);

const counts = fc.array(
  fc.record({ site: sites, forward: fc.integer({ min: 0, max: 3 }), requests: fc.integer({ min: 1, max: 50 }), views: fc.oneof(fc.integer({ min: -2, max: 60 }), fc.constantFrom(0.5, Number.NaN)) }),
  { maxLength: 40 },
);

property(
  "the views of a site are whole, never negative, never more than its counted requests, and exactly the page views counted in the seven days",
  fc.asyncProperty(counts, async (written) => {
    const opened = await openDatabase(new BunSqliteDriver(), FIRST_DAY);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const { database } = opened;
    const kept: { readonly day: string; readonly site: SiteId; readonly requests: number; readonly views: number }[] = [];
    let moment = FIRST_DAY;

    for (const { site, forward, requests, views } of written) {
      moment += forward * DAY;
      const counted = { day: dayOf(moment), site, requests, views };
      const valid = Number.isInteger(views) && views >= 0 && views <= requests;

      if (valid) {
        await database.addRequests(counted);
        kept.push(counted);
      } else {
        await expect(database.addRequests(counted)).rejects.toThrow(RangeError);
      }
    }

    const today = dayOf(moment);
    const week = viewDays(today);
    const read = await database.readViews(SITES, today);

    for (const site of SITES) {
      const views = read.get(site) ?? { today: Number.NaN, week: Number.NaN };
      const own = kept.filter((one) => one.site === site && week.includes(one.day));
      const sum = (pick: (one: (typeof own)[number]) => number, days: readonly string[]): number => own.filter((one) => days.includes(one.day)).reduce((total, one) => total + pick(one), 0);

      expect(views).toEqual({ today: sum((one) => one.views, [today]), week: sum((one) => one.views, week) });
      expect([Number.isInteger(views.today), views.today >= 0, views.today <= views.week, views.week <= sum((one) => one.requests, week)]).toEqual([true, true, true, true]);
    }
  }),
);
