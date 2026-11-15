import { freeLimitWarnings } from "@poplin/app/src/console/settings/free-limits";
import type { Login } from "@poplin/core/src/auth/logins";
import { MOST_STORE_CALLS } from "@poplin/app/src/sites/serve";
import { COPY_CALLS } from "@poplin/core/src/actions/duplicate";
import { SWEEP_SPARE_WRITES } from "@poplin/core/src/actions/sweep";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { expect, test } from "vitest";

import { FREE_LIMITS } from "../../src/limits/free-limits";

const settings = defaultSettings({ installer: "owner@example.com" as Login });
const warned = (changed: Partial<typeof settings>): string[] => [...freeLimitWarnings({ ...settings, ...changed }, FREE_LIMITS).keys()];

// Drift: the defaults are core's and the free plan's numbers are this package's. A default raised past one of them would put a new install outside the free plan, warning and all, on its first day.
test("a new install's settings are within every free limit; a day of 32,258 files is the last within the free month, and a publish of 5,001 files is above the free processing time", () => {

  expect([warned({}), warned({ max_files_per_day: 32_258 }), warned({ max_files_per_day: 32_259 }), warned({ max_files_per_publish: 5001 })]).toEqual([[], [], ["max_files_per_day"], ["max_files_per_publish"]]);
});

// Drift: R2 bills every operation past a month's free million writes and ten million reads. A default raised, a fourth read added to a request, or a larger share for the sweep would put a new install's fullest month past one of them.
test("a month of the fullest days the default settings allow stays inside R2's free operations: 991,000 writes and listings of 1,000,000, and 9,765,000 reads of 10,000,000", () => {
  const days = 31;
  const writes = days * (settings.max_storage_writes_per_day + SWEEP_SPARE_WRITES) + settings.max_storage_writes_per_day;
  const reads = days * (settings.requests_per_day * MOST_STORE_CALLS + settings.max_storage_writes_per_day / COPY_CALLS);

  expect({ writes, reads, warned: warned({}) }).toEqual({ writes: 991_000, reads: 9_765_000, warned: [] });
  expect([writes <= 1_000_000, reads <= FREE_LIMITS.storageReadsPerMonth.most]).toEqual([true, true]);
});

test.each([
  ["30,281 writes a day are the last within the free month", { max_storage_writes_per_day: 30_281 }, []],
  ["30,282 writes a day are above it", { max_storage_writes_per_day: 30_282 }, ["max_storage_writes_per_day"]],
  ["45,160 writes a day copy few enough files for a month's reads to stay free", { max_storage_writes_per_day: 45_160 }, ["max_storage_writes_per_day"]],
  ["45,162 writes a day can copy enough files to put a month's reads above the free ten million", { max_storage_writes_per_day: 45_162 }, ["max_storage_writes_per_day", "requests_per_day"]],
] as const)("%s", (_name, changed, keys) => {
  expect(warned(changed)).toEqual([...keys]);
});

// Drift: two limits are compared with `requests_per_day`. One warning kept by the setting's key would say that nothing more is served, and leave out that the reads are billed on a paid plan.
test("a day of requests above both the free requests and the free month of reads is told both", () => {
  const told = freeLimitWarnings({ ...settings, requests_per_day: 110_000 }, FREE_LIMITS).get("requests_per_day");

  expect(told).toBe(`${FREE_LIMITS.storageReadsPerMonth.warning}; ${FREE_LIMITS.requestsPerDay.warning}`);
});
