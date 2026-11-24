// The moments an expiry is chosen as: what a picked day and a span are sent as, so the moment a person read before the save is the one the server sets.

import { describe, expect, test } from "bun:test";
import { readExpires } from "@poplin/core/src/actions/sites/changes";

import { dayOf, dayStart, firstDay, sentFor } from "@/dialog/expiry/expiry-moments";
import { momentIn } from "@/lib/timezone";

/** A moment the tests count from: a minute before a day ends in UTC. */
const NOW = Date.UTC(2026, 10, 30, 23, 59);

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

/** A time zone 14 hours ahead of UTC, as the browser's own: its day is the next one for most of every day of UTC. */
const AHEAD = "Pacific/Kiritimati";

describe("the moments an expiry is chosen as", () => {
  // Drift: a picked day would end the site at the start of that day somewhere else: the evening before, for a person west of UTC.
  test.each(["own", "utc"] as const)("a picked day starts at midnight in the time zone chosen: %s", (choice) => {
    expect(momentIn(dayStart(new Date(2026, 11, 1), choice), choice)).toBe(choice === "utc" ? "01 Dec 2026, 00:00 UTC" : "01 Dec 2026, 00:00");
  });

  // Drift: the calendar would offer today, whose start has passed and is refused, or skip tomorrow.
  test.each(["own", "utc"] as const)("the first day to pick is the next one to start in the time zone chosen: %s", (choice) => {
    const starts = dayStart(firstDay(NOW, choice), choice);

    expect([starts > NOW, starts - NOW <= DAY_MS + 3_600_000]).toEqual([true, true]);
  });

  // Drift: what the client sends would be read by the server as another moment than the one a person saw: a day's start a second off, a moment set late by the time its request took, or a passed one set a second from now.
  test.each([
    ["a day's start in UTC", Date.UTC(2026, 11, 1), 0, true],
    ["a moment between two seconds", NOW + 90_500, 0, true],
    ["a moment a millisecond ahead", NOW + 1, 0, true],
    ["a moment whose request took a minute", NOW + 90_500, 60_000, true],
    ["a moment that has passed", NOW - 1, 0, false],
    ["this moment", NOW, 0, false],
    ["a moment that passed while its request was on its way", NOW + 1, 60_000, false],
  ])("the server sets %s to that very moment, and refuses one that is not ahead when it comes in", (_what, moment, took, taken) => {
    expect(readExpires(sentFor(moment), NOW + took)).toBe(taken ? moment : undefined);
  });

  // Drift: a token set to never, and Undo on a site that had no expiry, would send a moment where none was chosen.
  test("never is sent as the word the server reads as never", () => {
    expect(readExpires(sentFor("never"), NOW)).toBe("never");
  });

  // Drift: with UTC chosen the calendar would mark the day of the browser's own clock as today, which is another day for some hours of every day away from UTC.
  test("today in UTC is the day the moment lies in there, in a browser whose own day is the next one already: the last minute of a day, and the first of the next", () => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = AHEAD;

    try {
      const days = [dayOf(NOW, "utc"), dayOf(NOW + 120_000, "utc"), dayOf(NOW, "own")].map((day) => [day.getFullYear(), day.getMonth(), day.getDate()]);

      expect(days).toEqual([
        [2026, 10, 30],
        [2026, 11, 1],
        [2026, 11, 1],
      ]);
    } finally {
      process.env.TZ = own;
    }
  });
});
