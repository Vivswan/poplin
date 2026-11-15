// The time zone the dashboard writes its times in: the browser's own, or UTC, as a person chose on the Activity screen. The choice is kept in the browser.
// Every absolute time of the dashboard is written by the two writers here, so one choice holds on every screen.

import useLocalStorageState from "use-local-storage-state";

/** The key the choice is kept under in the browser. */
const KEY = "poplin.timezone";

/** A space as wide as a figure. */
const FIGURE_SPACE = "\u2007";

/** A written day that starts with one figure. */
const ONE_FIGURE_DAY = /^\d\D/;

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
 * Write a moment whole: the day and the time to the minute, in the chosen time zone. UTC is named after the time; the browser's own time zone is not.
 *
 * @param moment - milliseconds since the epoch
 * @param choice - the time zone to write in; left out, the one a person chose
 * @param own - the name of the browser's own time zone, such as `Europe/Berlin`; left out, the browser's
 */
export function momentIn(moment: number, choice: TimeZoneChoice = shown, own?: string): string {
  // The day and the time are written apart and joined here: what a browser puts between the two differs from one to the next.
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timeZoneOf(choice, own) }).format(moment);

  return `${dayIn(moment, choice, own)}, ${time}${choice === "utc" ? " UTC" : ""}`;
}

/**
 * Write the day of a moment in the chosen time zone: 14 Nov 2026. A day of one figure has a space as wide as a figure before it, so the days of a column stand under each other, and the times after them too.
 *
 * @param moment - milliseconds since the epoch
 * @param choice - the time zone to write in; left out, the one a person chose
 * @param own - the name of the browser's own time zone; left out, the browser's
 */
export function dayIn(moment: number, choice: TimeZoneChoice = shown, own?: string): string {
  const written = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: timeZoneOf(choice, own) }).format(moment);

  return ONE_FIGURE_DAY.test(written) ? `${FIGURE_SPACE}${written}` : written;
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
