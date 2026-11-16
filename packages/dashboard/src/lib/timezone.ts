// The time zone the dashboard writes its times in: the browser's own, or UTC, as a person chose on the Activity screen. The choice is kept in the browser.
// Every absolute time of the dashboard is written by the two writers here, so one choice holds on every screen.

import useLocalStorageState from "use-local-storage-state";

/** The key the choice is kept under in the browser. */
const KEY = "poplin.timezone";

/** How many milliseconds an hour and a day hold. */
const [HOUR_MS, DAY_MS] = [3_600_000, 86_400_000] as const;

/** How a moment within a week is written: 3 hours ago, yesterday, 2 days ago. */
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** The time zones a person chooses between: the browser's own, and UTC. */
export const TIMEZONES = ["own", "utc"] as const;

/** A person's choice of time zone. */
export type TimeZoneChoice = (typeof TIMEZONES)[number];

/** The choice every time is written in: the browser's own time zone until a screen is drawn. */
let shown: TimeZoneChoice = "own";

/** The time zone a choice stands for, as the platform's formatter takes it: `undefined` is the browser's own. */
function timeZoneOf(choice: TimeZoneChoice, own: string | undefined): string | undefined {
  return choice === "utc" ? "UTC" : own;
}

/**
 * The choice of time zone a person made, and the way to make another. A browser that kept none, or something else, has the browser's own time zone.
 *
 * The Activity screen, which holds the control, reads it itself.
 */
export function useTimeZoneChoice(): readonly [TimeZoneChoice, (choice: TimeZoneChoice) => void] {
  const [stored, keep] = useLocalStorageState<unknown>(KEY);

  return [stored === "utc" ? "utc" : "own", keep];
}

/**
 * Write the times of the screen that calls it in the time zone a person chose, and draw that screen again when the choice changes, here or in another tab.
 *
 * The frame of every screen calls it as it is drawn, before the screen inside it; a screen that shows a time calls it too, since a frame drawn again does not draw its screen again.
 */
export function useChosenTimeZone(): void {
  [shown] = useTimeZoneChoice();
}

/**
 * Write a moment as a column writes it whose heading names the time zone: the day and the time to the minute, in the chosen time zone, with no name after it.
 *
 * @param moment - milliseconds since the epoch
 * @param choice - the time zone to write in; left out, the one a person chose
 * @param own - the name of the browser's own time zone, such as `Europe/Berlin`; left out, the browser's
 */
export function unnamedMomentIn(moment: number, choice: TimeZoneChoice = shown, own?: string): string {
  // The day and the time are written apart and joined here: what a browser puts between the two differs from one to the next.
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timeZoneOf(choice, own) }).format(moment);

  return `${dayIn(moment, choice, own)}, ${time}`;
}

/**
 * Write a moment whole: the day and the time to the minute, in the chosen time zone. UTC is named after the time; the browser's own time zone is not.
 *
 * @param moment - milliseconds since the epoch
 * @param choice - the time zone to write in; left out, the one a person chose
 * @param own - the name of the browser's own time zone, such as `Europe/Berlin`; left out, the browser's
 */
export function momentIn(moment: number, choice: TimeZoneChoice = shown, own?: string): string {
  return `${unnamedMomentIn(moment, choice, own)}${choice === "utc" ? " UTC" : ""}`;
}

/**
 * Write the day of a moment in the chosen time zone: 14 Nov 2026, 06 Sep 2026. The day always has two figures and the month three letters, so the days of a column stand under each other from its left edge.
 *
 * @param moment - milliseconds since the epoch
 * @param choice - the time zone to write in; left out, the one a person chose
 * @param own - the name of the browser's own time zone; left out, the browser's
 */
export function dayIn(moment: number, choice: TimeZoneChoice = shown, own?: string): string {
  // The parts are read one by one and joined here: this way of writing has three letters for every month, where the British one has four for September.
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: timeZoneOf(choice, own) }).formatToParts(moment);
  const [day, month, year] = (["day", "month", "year"] as const).map((type) => parts.find((part) => part.type === type)?.value ?? "");

  return `${day} ${month} ${year}`;
}

/**
 * The date of a moment in the chosen time zone, as a UTC day is written: 2026-11-14.
 *
 * @param moment - milliseconds since the epoch
 * @param choice - the time zone to read the date in; left out, the one a person chose
 * @param own - the name of the browser's own time zone; left out, the browser's
 */
export function dateIn(moment: number, choice: TimeZoneChoice = shown, own?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: timeZoneOf(choice, own) }).formatToParts(moment);
  const [year, month, day] = (["year", "month", "day"] as const).map((type) => parts.find((part) => part.type === type)?.value ?? "");

  return `${year}-${month}-${day}`;
}

/** The day a moment falls on in the chosen time zone, as a count of days: two moments on the same date there have the same count, and the next date has one more. */
function dayCountIn(moment: number, choice: TimeZoneChoice, own: string | undefined): number {
  return Date.parse(`${dateIn(moment, choice, own)}T00:00:00Z`) / DAY_MS;
}

/**
 * Write a moment briefly, as someone who reads it now says it: "just now" within half an hour, the hours on the same date or within half a day, "yesterday" and the days within a week, and the day otherwise.
 *
 * The day words count dates in the chosen time zone, not spans of 24 hours: "yesterday" is said only of the date before the reader's.
 *
 * @param moment - milliseconds since the epoch
 * @param now - the moment it is read at
 * @param choice - the time zone to count dates in; left out, the one a person chose
 * @param own - the name of the browser's own time zone; left out, the browser's
 */
export function briefMomentIn(moment: number, now: number, choice: TimeZoneChoice = shown, own?: string): string {
  const hours = Math.round((moment - now) / HOUR_MS);
  if (hours === 0) return "just now";

  const days = dayCountIn(moment, choice, own) - dayCountIn(now, choice, own);
  if (days === 0 || Math.abs(moment - now) < DAY_MS / 2) return RELATIVE_FORMAT.format(hours, "hour");

  return Math.abs(days) >= 7 ? dayIn(moment, choice, own) : RELATIVE_FORMAT.format(days, "day");
}

/**
 * The short name of the browser's own time zone at a moment, such as CET or GMT+1: it differs between summer and winter.
 *
 * @param own - the name of the time zone; left out, the browser's
 */
export function ownTimeZoneName(moment: number = Date.now(), own?: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZoneName: "short", timeZone: own }).formatToParts(moment);

  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}
