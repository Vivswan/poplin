// When a site deletes itself: what a person chooses between, what each choice is sent as, and how the moment is written.

import type { Site } from "@/lib/sites";
import { momentIn, type TimeZoneChoice } from "@/lib/timezone";

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** How many characters of an ISO timestamp are its day. */
const DAY_LENGTH = 10;

/** The spans a person chooses between, in days from the moment of the save. */
export const SPANS = [1, 7, 30] as const;

/** Write when a site deletes itself: the day and the time, in the time zone a person chose. */
export function expiryMoment(expires: Site["expires"]): string {
  return expires === "never" ? "Never" : momentIn(expires);
}

/** The moment a span of days ends when it is counted from `now`: what a choice shows before it is saved. */
export function afterDays(days: number, now: number): number {
  return now + days * DAY_MS;
}

/** A span of days as it is sent. */
export function spanOf(days: number): string {
  return `${days}d`;
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

/**
 * What sets a site to delete itself at a moment.
 *
 * A moment a day starts at in UTC is sent as that day, and set exactly. Any other that is still ahead is sent as the whole seconds left to it, so it is set to the second, never earlier.
 * A moment that has passed is sent as its day in UTC, which has started, so the server refuses it as it refuses any day that is not ahead.
 */
export function sentFor(moment: number, now: number): string {
  const day = new Date(moment).toISOString().slice(0, DAY_LENGTH);
  if (Date.parse(`${day}T00:00:00Z`) === moment || moment <= now) return day;

  return `${Math.max(1, Math.ceil((moment - now) / 1000))}s`;
}

/**
 * What puts back the moment a site had before a change.
 *
 * @param previous - when the site deleted itself before the change; one that has passed by `now` is refused when it is sent
 */
export function backTo(previous: Site["expires"], now: number): string {
  return previous === "never" ? "never" : sentFor(previous, now);
}
