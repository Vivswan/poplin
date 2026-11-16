import { describe, expect, test } from "bun:test";

import { dayOf, daysUpTo, showViews, viewDays, weeksUpTo } from "../../src/records/views";

describe("views", () => {
  // Drift: a sampled count shown as it is stored reads as an exact number; every face words a count here, so one wrong rounding is wrong everywhere.
  test.each([
    [0, "about 10 or fewer"],
    [9, "about 10 or fewer"],
    [10, "about 10"],
    [126, "about 130"],
    [1234, "about 1,200"],
    [98_765, "about 99,000"],
    [1_000_000, "about 1,000,000"],
  ])("%d views are worded as %s", (count, worded) => {
    expect(showViews(count)).toBe(worded);
  });

  // Drift: the days are compared as text with the rows of the counts; a week that lost a day at a month's or a year's end, or took the local day, would read the wrong rows.
  test.each([
    ["2026-11-13", ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]],
    ["2027-01-02", ["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]],
    ["2028-03-01", ["2028-02-24", "2028-02-25", "2028-02-26", "2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"]],
  ])("the seven days ending on %s are that day and the six before it", (day, days) => {
    expect(viewDays(day)).toEqual(days);
  });

  // Drift: the first day of a year's run is the day the counts are dropped before; a day off deletes a kept day or keeps a row for ever.
  test("a run of days ends on its day and starts as many days before, a leap day counted, and is at most a year long", () => {
    const year = daysUpTo("2028-03-01", 365);

    expect([daysUpTo("2026-11-13", 1), year.length, year[0], year.at(-1)]).toEqual([["2026-11-13"], 365, "2027-03-03", "2028-03-01"]);
    for (const count of [0, 366, 1.5]) expect(() => daysUpTo("2026-11-13", count)).toThrow(RangeError);
  });

  // Drift: a graph of a long stretch draws a point a week; a week that ended on another day than the last, or held six or eight days, would put a day's opens beside its own week.
  test("the weeks of a run end on its last day, each seven days long but the first, which holds the days left over", () => {
    const year = weeksUpTo("2026-11-13", 365);

    expect([weeksUpTo("2026-11-13", 9), weeksUpTo("2026-11-13", 7).length, year.length, year[0], year.at(-1)?.[0], year.at(-1)?.at(-1), year.flat().length]).toEqual([
      [
        ["2026-11-05", "2026-11-06"],
        ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"],
      ],
      1,
      53,
      ["2025-11-14"],
      "2026-11-07",
      "2026-11-13",
      365,
    ]);
    for (const count of [0, 366]) expect(() => weeksUpTo("2026-11-13", count)).toThrow(RangeError);
  });

  test("a moment falls on its UTC day, up to the last millisecond before midnight", () => {
    expect([dayOf(Date.UTC(2026, 10, 13, 23, 59, 59, 999)), dayOf(Date.UTC(2026, 10, 14))]).toEqual(["2026-11-13", "2026-11-14"]);
  });
});
