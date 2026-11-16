// What the lines of the Usage screen say of the day their numbers are counted over, and of the day a month's numbers are counted from.

import { describe, expect, test } from "bun:test";

import { spansOf } from "@/usage/usage-spans";

describe("the day and the month of the Usage screen's numbers", () => {
  // Drift: the numbers are of a UTC day while a person reads the screen on a date of their own; "today" on another date, or a day named on the same one, says the numbers are of a day they are not of.
  // A month's numbers are counted from the first day of the UTC month, which their line names whatever the reader's date.
  test.each([
    ["the same date in UTC", "2026-11-16", Date.UTC(2026, 10, 16, 4, 59), "utc", undefined, { day: "today", month: "since 01 Nov UTC" }],
    ["late evening west of UTC, the UTC day already the next", "2026-11-16", Date.UTC(2026, 10, 16, 4, 59), "own", "America/New_York", { day: "on 16 Nov UTC", month: "since 01 Nov UTC" }],
    ["early morning east of UTC, the UTC day still the one before", "2026-11-15", Date.UTC(2026, 10, 15, 23, 30), "own", "Asia/Tokyo", { day: "on 15 Nov UTC", month: "since 01 Nov UTC" }],
    ["the same date west of UTC", "2026-11-16", Date.UTC(2026, 10, 16, 18), "own", "America/New_York", { day: "today", month: "since 01 Nov UTC" }],
    ["the last evening of a month west of UTC", "2026-12-01", Date.UTC(2026, 11, 1, 2), "own", "America/New_York", { day: "on 01 Dec UTC", month: "since 01 Dec UTC" }],
    ["an answer read on the day before, in UTC", "2026-11-15", Date.UTC(2026, 10, 16, 0, 1), "utc", undefined, { day: "on 15 Nov UTC", month: "since 01 Nov UTC" }],
  ] as const)("%s", (_, day, now, choice, own, says) => {
    expect(spansOf(day, now, choice, own)).toEqual(says);
  });
});
