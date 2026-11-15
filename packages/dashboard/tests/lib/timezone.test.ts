// The time zone the dashboard's times are written in: what each choice writes for the same moment, on both sides of a change of the clocks.

import { describe, expect, test } from "bun:test";

import { dayIn, momentIn, ownTimeZoneName } from "@/lib/timezone";

/** A time zone whose clocks go forward on 29 March 2026 at 01:00 UTC, as the browser's own. */
const OWN = "Europe/Berlin";

/** The last minute before that change, and the first after it. */
const [BEFORE, AFTER] = [Date.UTC(2026, 2, 29, 0, 59), Date.UTC(2026, 2, 29, 1, 0)];

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
    ["own", "\u20071 Jan 2027"],
    ["utc", "31 Dec 2026"],
  ] as const)("names the day of a moment in the timeZone chosen: %s", (choice, day) => {
    expect(dayIn(Date.UTC(2026, 11, 31, 23, 30), choice, OWN)).toBe(day);
  });

  // Drift: the choice's label would name the winter time zone in summer.
  test("names the browser's own timeZone as it is at the moment", () => {
    expect([ownTimeZoneName(BEFORE, OWN), ownTimeZoneName(AFTER, OWN)]).toEqual(["CET", "CEST"]);
  });
});
