import { expect, test } from "bun:test";

import { COPY_CALLS } from "@poplin/core/src/actions/duplicate";
import { defaultSettings, type SettingValues, sizeBytes } from "@poplin/core/src/records/settings";

import { freeLimitMarks } from "../../../src/console/settings/free-limits";
import { MOST_STORE_CALLS } from "../../../src/sites/serve";
import { FREE_LIMITS } from "../support/install";

const DEFAULTS = defaultSettings({ installer: "owner@example.com" as SettingValues["logins"][number] });

/** The reads of the storage a month of 31 days costs at a day's requests and writes. */
function readsAMonth(requests: number, writes: number): number {
  return 31 * (requests * MOST_STORE_CALLS + Math.floor(writes / COPY_CALLS));
}

// Drift: the month's reads would be marked at a day's requests that already cost more than the limit, or that still leave room under it, so the warning would come late or early.
test.each([30_000, 0, 31, 200_001])("the mark of the month's reads is the last count of a day's requests that stays within them, at %d writes a day", (writes) => {
  const [reads] = freeLimitMarks({ ...DEFAULTS, max_storage_writes_per_day: writes }, FREE_LIMITS).requests_per_day ?? [];
  const most = FREE_LIMITS.storageReadsPerMonth.most;
  const over = reads?.over ?? Number.NaN;

  expect([reads?.warning, readsAMonth(over, writes) <= most, readsAMonth(over + 1, writes) > most]).toEqual(["above the free 10,000,000 reads a month", true, true]);
});

test("the defaults are within every mark, so a new install shows no warning", () => {
  const marks = freeLimitMarks(DEFAULTS, FREE_LIMITS);
  const values: Readonly<Record<string, unknown>> = { ...DEFAULTS, max_total_size: sizeBytes(DEFAULTS.max_total_size), max_site_size: sizeBytes(DEFAULTS.max_site_size), logins: DEFAULTS.logins.length };

  expect(Object.entries(marks).filter(([key, bounds]) => bounds.some((bound) => !(Number(values[key]) <= bound.over)))).toEqual([]);
});
