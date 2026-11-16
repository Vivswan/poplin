// What a line of the Usage screen says of the time its number is counted over. The numbers are of a UTC day, or counted from the first day of its UTC month, and a person reads the screen in the time zone they chose.
//
//   the UTC day of the numbers    the reader's date    the day reads    the month reads
//   2026-11-16                    2026-11-16           today            since 01 Nov UTC
//   2026-11-16                    2026-11-15           on 16 Nov UTC    since 01 Nov UTC
//   2026-12-01                    2026-11-30           on 01 Dec UTC    since 01 Dec UTC

import { dateIn, dayIn, type TimeZoneChoice } from "@/lib/timezone";

/** The length of the year and the month in a date. */
const MONTH_LENGTH = 7;

/** Where the day and the month end in a day written in words, such as 16 Nov 2026. */
const DAY_END = 6;

/** What the lines say of their time: the day's lines and the month's. */
interface Spans {
  readonly day: string;
  readonly month: string;
}

/**
 * Say the day and the month the numbers are counted over as a person reads them.
 *
 * @param day - the UTC day of the numbers, such as `2026-11-16`
 * @param now - the moment the numbers were read, in milliseconds since the epoch
 * @param choice - the time zone the reader's date is read in; left out, the one a person chose
 * @param own - the name of the browser's own time zone; left out, the browser's
 * @returns "today" where the reader's date at that moment is the day, and else the UTC day by name; the month's lines always name the UTC day they are counted from
 */
export function spansOf(day: string, now: number, choice?: TimeZoneChoice, own?: string): Spans {
  const first = `${day.slice(0, MONTH_LENGTH)}-01`;

  return {
    day: dateIn(now, choice, own) === day ? "today" : `on ${dayIn(Date.parse(day), "utc").slice(0, DAY_END)} UTC`,
    month: `since ${dayIn(Date.parse(first), "utc").slice(0, DAY_END)} UTC`,
  };
}
