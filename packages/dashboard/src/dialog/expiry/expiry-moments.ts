// The moments an expiry is chosen as, whatever expires: a span of days counted from now, the start of a day picked in the calendar, and how a moment is sent.

import type { TimeZoneChoice } from "@/lib/timezone";

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** The moment a span of days ends when it is counted from `now`: what a choice shows, and what it saves. */
export function afterDays(days: number, now: number): number {
  return now + days * DAY_MS;
}

/**
 * The moment a day of the calendar starts in the time zone a person chose.
 *
 * @param picked - the day as the calendar hands it over: its year, month, and day are read as the calendar shows them
 */
export function dayStart(picked: Date, choice: TimeZoneChoice): number {
  const parts = [picked.getFullYear(), picked.getMonth(), picked.getDate()] as const;

  return choice === "utc" ? Date.UTC(...parts) : new Date(...parts).getTime();
}

/**
 * The first day a site can be told to delete itself on: the day after the one `now` lies in, in the time zone a person chose.
 *
 * @returns the day as the calendar takes one
 */
export function firstDay(now: number, choice: TimeZoneChoice): Date {
  const at = new Date(now);
  if (choice === "utc") return new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);

  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
}

/** What sets a site to delete itself at a moment: the moment itself, so the time a request takes moves nothing. The server refuses one that has passed. */
export function sentFor(moment: number): string {
  return new Date(moment).toISOString();
}
