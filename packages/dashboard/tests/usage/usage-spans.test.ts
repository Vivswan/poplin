// What the lines of the Usage screen say of the day and the month their numbers are counted over.

import { describe, expect, test } from "bun:test";

import { spansOf } from "@/usage/usage-spans";

describe("the day and the month of the Usage screen's numbers", () => {
  // Drift: the numbers are of a UTC day while a person reads the screen on a date of their own; "today" on another date, or a day named on the same one, says the numbers are of a day they are not of.
  test.each([
    ["the same date in UTC", "2026-11-16", Date.UTC(2026, 10, 16, 4, 59), "utc", undefined, { day: "today", month: "this month" }],
    ["late evening west of UTC, the UTC day already the next", "2026-11-16", Date.UTC(2026, 10, 16, 4, 59), "own", "America/New_York", { day: "on 16 Nov UTC", month: "this month" }],
    ["early morning east of UTC, the UTC day still the one before", "2026-11-15", Date.UTC(2026, 10, 15, 23, 30), "own", "Asia/Tokyo", { day: "on 15 Nov UTC", month: "this month" }],
    ["the same date west of UTC", "2026-11-16", Date.UTC(2026, 10, 16, 18), "own", "America/New_York", { day: "today", month: "this month" }],
    ["the last evening of a month west of UTC", "2026-12-01", Date.UTC(2026, 11, 1, 2), "own", "America/New_York", { day: "on 01 Dec UTC", month: "in Dec UTC" }],
    ["an answer read on the day before, in UTC", "2026-11-15", Date.UTC(2026, 10, 16, 0, 1), "utc", undefined, { day: "on 15 Nov UTC", month: "this month" }],
  ] as const)("%s", (_, day, now, choice, own, says) => {
    expect(spansOf(day, now, choice, own)).toEqual(says);
  });
});
