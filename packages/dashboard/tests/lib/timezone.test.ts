// The time zone the dashboard's times are written in: what each choice writes for the same moment, on both sides of a change of the clocks.

import { describe, expect, test } from "bun:test";

import { briefMomentIn, dayIn, momentIn, ownTimeZoneName } from "@/lib/timezone";

/** A time zone whose clocks go forward on 29 March 2026 at 01:00 UTC, as the browser's own. */
const OWN = "Europe/Berlin";

/** The last minute before that change, and the first after it. */
const [BEFORE, AFTER] = [Date.UTC(2026, 2, 29, 0, 59), Date.UTC(2026, 2, 29, 1, 0)];

/** Two time zones a day apart: 14 hours ahead of UTC, and 11 hours behind it. */
const [AHEAD, BEHIND] = ["Pacific/Kiritimati", "Pacific/Pago_Pago"];

/** The moment the brief times are read at: 16 Nov 2026, 06:36 UTC, which is 16 Nov, 20:36 in the first time zone and 15 Nov, 19:36 in the second. */
const READ = Date.UTC(2026, 10, 16, 6, 36);

describe("a time of the dashboard", () => {
  // Drift: a time would be written in UTC whatever was chosen, UTC would go unnamed, or an hour would be lost or doubled where the clocks change.
  test.each([
    ["the browser's own timeZone, before the clocks change", BEFORE, "own", "29 Mar 2026, 01:59"],
    ["the browser's own timeZone, after the clocks change", AFTER, "own", "29 Mar 2026, 03:00"],
    ["UTC, before the clocks change", BEFORE, "utc", "29 Mar 2026, 00:59 UTC"],
    ["UTC, after the clocks change", AFTER, "utc", "29 Mar 2026, 01:00 UTC"],
  ] as const)("in %s reads %s", (_what, moment, choice, written) => {
    expect(momentIn(moment, choice, OWN)).toBe(written);
  });

  // Drift: a day near midnight would be told as the UTC day under the browser's own time zone, or the other way round.
  test.each([
    ["own", "01 Jan 2027"],
    ["utc", "31 Dec 2026"],
  ] as const)("names the day of a moment in the timeZone chosen: %s", (choice, day) => {
    expect(dayIn(Date.UTC(2026, 11, 31, 23, 30), choice, OWN)).toBe(day);
  });

  // Drift: a month would be written with four letters, so the times of a column would end at different places.
  test("writes every month with three letters", () => {
    const months = Array.from({ length: 12 }, (_, month) => dayIn(Date.UTC(2026, month, 15, 12), "utc").slice(3, -5));

    expect(months).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
  });

  // Drift: the choice's label would name the winter time zone in summer.
  test("names the browser's own timeZone as it is at the moment", () => {
    expect([ownTimeZoneName(BEFORE, OWN), ownTimeZoneName(AFTER, OWN)]).toEqual(["CET", "CEST"]);
  });

  // Drift: the day words would count spans of 24 hours again, so "yesterday" would be said of the reader's own date, and "2 days ago" of the date before it.
  test.each([
    ["15 hours back, the reader's own date ahead of UTC", Date.UTC(2026, 10, 15, 15, 21), "own", AHEAD, "15 hours ago"],
    ["15 hours back, the reader's own date behind UTC", Date.UTC(2026, 10, 15, 15, 21), "own", BEHIND, "15 hours ago"],
    ["15 hours back, the date before in UTC", Date.UTC(2026, 10, 15, 15, 21), "utc", AHEAD, "yesterday"],
    ["37 hours back, the date before the reader's behind UTC", Date.UTC(2026, 10, 14, 17, 45), "own", BEHIND, "yesterday"],
    ["32 hours back, two dates before in UTC", Date.UTC(2026, 10, 14, 23, 0), "utc", AHEAD, "2 days ago"],
    ["9 hours back, across midnight in UTC", Date.UTC(2026, 10, 15, 21, 36), "utc", AHEAD, "9 hours ago"],
    ["six dates before the reader's", Date.UTC(2026, 10, 9, 23, 0), "own", AHEAD, "6 days ago"],
  ] as const)("is told briefly by the reader's dates: %s", (_what, moment, choice, own, written) => {
    expect(briefMomentIn(moment, READ, choice, own)).toBe(written);
  });
});
