import { describe, expect, test } from "bun:test";

import { secondsToNextDay } from "../../src/database/driver";

describe("secondsToNextDay", () => {
  // Drift: a day's allowance begins anew at midnight UTC whatever the clock of the machine says; a wait counted in local time, or one of zero seconds, would send a caller back too early.
  test.each([
    ["the first millisecond of a day", "2026-11-14T00:00:00.000Z", 86_400],
    ["an hour before midnight", "2026-11-14T23:00:00.000Z", 3600],
    ["half a second before midnight", "2026-11-14T23:59:59.500Z", 1],
    ["the last millisecond of a year", "2026-12-31T23:59:59.999Z", 1],
  ])("%s is %s: %d seconds to go", (_name, moment, seconds) => {
    expect(secondsToNextDay(Date.parse(moment))).toBe(seconds);
  });
});
