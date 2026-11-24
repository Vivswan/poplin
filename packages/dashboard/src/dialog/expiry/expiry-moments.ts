// The moments an expiry is chosen as, whatever expires: a span of days counted from now, the start of a day picked in the calendar, how a choice is written, and how it is sent.

import { momentIn, type TimeZoneChoice } from "@/lib/timezone";

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** How many days the span that is written as a year holds. */
const YEAR_DAYS = 365;

/** When something expires: a moment in milliseconds since the epoch, or never. */
export type Expiry = "never" | number;

/** The moment a span of days ends when it is counted from `now`: what a choice shows, and what it saves. */
export function afterDays(days: number, now: number): number {
  return now + days * DAY_MS;
}

/** Write a span of days as a choice names it: 1 day, 30 days, 1 year. */
export function spanWords(days: number): string {
  if (days === YEAR_DAYS) return "1 year";

  return days === 1 ? "1 day" : `${days} days`;
}

/** Write when something expires: the day and the time, in the time zone a person chose. */
export function expiryMoment(expires: Expiry): string {
  return expires === "never" ? "Never" : momentIn(expires);
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
 * The day `now` lies in, in the time zone a person chose: the one the calendar marks as today.
 *
 * @param ahead - how many days after it; left out, that day itself
 * @returns the day as the calendar takes one
 */
export function dayOf(now: number, choice: TimeZoneChoice, ahead = 0): Date {
  const at = new Date(now);
  if (choice === "utc") return new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + ahead);

  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + ahead);
}

/**
 * The first day an expiry can be set to: the day after the one `now` lies in, in the time zone a person chose.
 *
 * @returns the day as the calendar takes one
 */
export function firstDay(now: number, choice: TimeZoneChoice): Date {
  return dayOf(now, choice, 1);
}

/** What sets an expiry: `never`, or the moment itself, so the time a request takes moves nothing. The server refuses a moment that has passed. */
export function sentFor(expires: Expiry): string {
  return expires === "never" ? "never" : new Date(expires).toISOString();
}
