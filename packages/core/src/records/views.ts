// How often a site's pages were opened: the two counts a site is shown with, the days they span, and the one way a count is worded.
//
// A count is an estimate. The day's requests are sampled, and a sampled request stands for up to 50, so no count is shown as an exact number.

import * as v from "valibot";

import { COUNT } from "./fields";

/** How many UTC days the counts are kept and summed over, today included. */
const VIEW_DAYS = 7;

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** How many characters of an ISO moment are its day. */
const DAY_LENGTH = 10;

/** Below this a sampled count says too little to name a number. */
const FEWEST_NAMED = 10;

/** How many digits of a count are shown; the rest are zeros. */
const SHOWN_DIGITS = 2;

/** The two counts of a site's views, each a whole number from 0. */
export const SITE_VIEWS = v.object({ today: COUNT, week: COUNT });

/** About how many times a site's pages were opened: on the UTC day so far, and over the last seven UTC days, that day included. */
export type SiteViews = Readonly<v.InferOutput<typeof SITE_VIEWS>>;

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
 * The days a site's views are summed over.
 *
 * @param day - a UTC date, such as `2026-11-13`
 * @returns that day and the six before it, the earliest first
 */
export function viewDays(day: string): string[] {
  const last = Date.parse(`${day}T00:00:00Z`);

  return Array.from({ length: VIEW_DAYS }, (_day, at) => dayOf(last - (VIEW_DAYS - 1 - at) * DAY_MS));
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
