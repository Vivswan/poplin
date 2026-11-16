// How often a site's pages were opened: the two counts a site is shown with, the days they span, and the one way a count is worded.
//
// A count is an estimate. The day's requests are sampled, and a sampled request stands for up to 50, so no count is shown as an exact number.

import * as v from "valibot";

import type { SiteId } from "../sites/ids";

import { COUNT } from "./fields";

/** How many UTC days a site's count is summed over, today included. */
const VIEW_DAYS = 7;

/** How many UTC days the counts are kept, today included: the longest stretch a read day by day spans. */
export const KEPT_DAYS = 365;

/** The most sites one read day by day names: a read of a year then finds under twenty thousand rows by their keys. */
export const MOST_SITES_COMPARED = 50;

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** How many characters of an ISO moment are its day. */
const DAY_LENGTH = 10;

/** Below this a sampled count says too little to name a number. */
const FEWEST_NAMED = 10;

/** How many days a week holds. */
const WEEK = 7;

/** How many digits of a count are shown; the rest are zeros. */
const SHOWN_DIGITS = 2;

/** The two counts of a site's views, each a whole number from 0. */
export const SITE_VIEWS = v.object({ today: COUNT, week: COUNT });

/** About how many times a site's pages were opened: on the UTC day so far, and over the last seven UTC days, that day included. */
export type SiteViews = Readonly<v.InferOutput<typeof SITE_VIEWS>>;

/** Page views over a run of days, step by step, a step being a day or a week: the day each step starts on, the earliest first, and one count a step for all sites together and for each site asked for, 0 where nothing was counted. */
export interface CountedViews {
  readonly days: readonly string[];
  readonly all: readonly number[];
  readonly sites: ReadonlyMap<SiteId, readonly number[]>;
}

/**
 * The UTC day a moment falls on.
 *
 * @param moment - milliseconds since the epoch
 * @returns the date, such as `2026-11-13`
 */
export function dayOf(moment: number): string {
  return new Date(moment).toISOString().slice(0, DAY_LENGTH);
}

/**
 * A run of UTC days that ends on one.
 *
 * @param day - a UTC date, such as `2026-11-13`
 * @param count - how many days, that day included: a whole number from 1 to the days kept
 * @returns the days, the earliest first
 * @throws {RangeError} `count` is not such a number
 */
export function daysUpTo(day: string, count: number): string[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > KEPT_DAYS) throw new RangeError(`a run of days is 1 to ${KEPT_DAYS} days long, not ${count}`);

  const last = Date.parse(`${day}T00:00:00Z`);

  return Array.from({ length: count }, (_day, at) => dayOf(last - (count - 1 - at) * DAY_MS));
}

/**
 * The weeks of a run of UTC days that ends on one. The weeks end on that day, so the first holds the days before the first whole week and may be shorter.
 *
 * @param day - a UTC date, such as `2026-11-13`
 * @param count - how many days, that day included: a whole number from 1 to the days kept
 * @returns the days of each week, the earliest week first
 * @throws {RangeError} `count` is not such a number
 */
export function weeksUpTo(day: string, count: number): string[][] {
  const days = daysUpTo(day, count);
  const weeks = Math.ceil(count / WEEK);

  return Array.from({ length: weeks }, (_week, at) => days.slice(Math.max(count - (weeks - at) * WEEK, 0), count - (weeks - at - 1) * WEEK));
}

/**
 * The days a site's views are summed over.
 *
 * @param day - a UTC date, such as `2026-11-13`
 * @returns that day and the six before it, the earliest first
 */
export function viewDays(day: string): string[] {
  return daysUpTo(day, VIEW_DAYS);
}

/**
 * Word a count of views, never as an exact number.
 *
 * @returns `about 10 or fewer` below ten, where a sample may have missed a few opens, and otherwise `about` and the count rounded to two digits, such as `about 1,200`
 */
export function showViews(count: number): string {
  if (count < FEWEST_NAMED) return `about ${FEWEST_NAMED} or fewer`;

  return `about ${Number(count.toPrecision(SHOWN_DIGITS)).toLocaleString("en-US")}`;
}
