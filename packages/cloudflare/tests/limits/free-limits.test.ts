import { freeLimitWarnings } from "@poplin/app/src/dashboard/settings/free-limits";
import type { Login } from "@poplin/core/src/auth/logins";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { expect, test } from "vitest";

import { FREE_LIMITS } from "../../src/limits/free-limits";

// Drift: the defaults are core's and the free plan's numbers are this package's. A default raised past one of them would put a new install outside the free plan, warning and all, on its first day.
test("a new install's settings are within every free limit; a day of 32,258 files is the last within the free month, and a publish of 5,001 files is above the free processing time", () => {
  const settings = defaultSettings({ installer: "owner@example.com" as Login, hostname: "poplin.example.com" });
  const warned = (changed: Partial<typeof settings>): string[] => [...freeLimitWarnings({ ...settings, ...changed }, FREE_LIMITS).keys()];

  expect([warned({}), warned({ max_files_per_day: 32_258 }), warned({ max_files_per_day: 32_259 }), warned({ max_files_per_publish: 5001 })]).toEqual([[], [], ["max_files_per_day"], ["max_files_per_publish"]]);
});
