// When a site deletes itself: what each choice of the panel is sent as, so the moment a person read before the save is the one the server sets.

import { describe, expect, test } from "bun:test";
import { readExpires } from "@poplin/core/src/actions/changes";

import { momentIn } from "@/lib/timezone";
import { backTo, dayStart, firstDay, sentFor } from "@/sites/expiry";

/** A moment the tests count from: a minute before a day ends in UTC. */
const NOW = Date.UTC(2026, 10, 30, 23, 59);

/** How many milliseconds a day holds. */
const DAY_MS = 86_400_000;

describe("when a site deletes itself", () => {
  // Drift: a picked day would end the site at the start of that day somewhere else: the evening before, for a person west of UTC.
  test.each(["own", "utc"] as const)("a picked day starts at midnight in the time zone chosen: %s", (choice) => {
    expect(momentIn(dayStart(new Date(2026, 11, 1), choice), choice)).toBe(choice === "utc" ? "01 Dec 2026, 00:00 UTC" : "01 Dec 2026, 00:00");
  });

  // Drift: the calendar would offer today, whose start has passed and is refused, or skip tomorrow.
  test.each(["own", "utc"] as const)("the first day to pick is the next one to start in the time zone chosen: %s", (choice) => {
    const starts = dayStart(firstDay(NOW, choice), choice);

    expect([starts > NOW, starts - NOW <= DAY_MS + 3_600_000]).toEqual([true, true]);
  });

  // Drift: what the client sends would be read by the server as another moment than the one a person saw: a day's start a second off, a moment set early, or a passed one set a second from now.
  test.each([
    ["a day's start in UTC", Date.UTC(2026, 11, 1), 0],
    ["a moment between two seconds", NOW + 90_500, 500],
    ["a moment a millisecond ahead", NOW + 1, 999],
    ["a moment that has passed", NOW - 1, undefined],
    ["this moment", NOW, undefined],
  ])("the server sets %s to that moment, no earlier and under a second later, and refuses one that is not ahead", (_what, moment, late) => {
    const set = readExpires(sentFor(moment, NOW), NOW);

    expect(set).toBe(late === undefined ? undefined : moment + late);
  });

  // Drift: Undo would leave an expiry on a site that had none, or put a moment back early.
  test("what a site had before is put back: never, or the same moment as the server reads it", () => {
    expect([readExpires(backTo("never", NOW), NOW), readExpires(backTo(NOW + 30_000, NOW), NOW)]).toEqual(["never", NOW + 30_000]);
  });
});
