// What a line of the Usage screen says of the time its number is counted over. The numbers are of a UTC day and a UTC month, and a person reads the screen in the time zone they chose.
//
//   the UTC day of the numbers    the reader's date    the day reads    the month reads
//   2026-11-16                    2026-11-16           today            this month
//   2026-11-16                    2026-11-15           on 16 Nov UTC    this month
//   2026-12-01                    2026-11-30           on 01 Dec UTC    in Dec UTC

import { dateIn, dayIn, type TimeZoneChoice } from "@/lib/timezone";

/** The length of the year and the month in a date. */
const MONTH_LENGTH = 7;

/** Where the day and the month stand in a day written in words, such as 16 Nov 2026. */
const IN_WORDS = { dayEnd: 6, monthStart: 3 } as const;

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
 * @returns "today" and "this month" where the reader's date at that moment is in them, and else the UTC day and month by name
 */
export function spansOf(day: string, now: number, choice?: TimeZoneChoice, own?: string): Spans {
  const date = dateIn(now, choice, own);
  const words = dayIn(Date.parse(day), "utc");

  return {
    day: date === day ? "today" : `on ${words.slice(0, IN_WORDS.dayEnd)} UTC`,
    month: date.slice(0, MONTH_LENGTH) === day.slice(0, MONTH_LENGTH) ? "this month" : `in ${words.slice(IN_WORDS.monthStart, IN_WORDS.dayEnd)} UTC`,
  };
}
