import { expect, test } from "bun:test";

import { defaultSettings, type SettingValues, sizeBytes } from "@poplin/core/src/records/settings";

import { pairMarks } from "../../../src/console/settings/pair-limits";

const DEFAULTS = defaultSettings({ installer: "owner@example.com" as SettingValues["users"][number] });

// Drift: the defaults themselves would stand under a warning: one site at 200 MB under 9 GB for all, one visitor at 600 a minute under 6,000 for a site.
test("the defaults are within every mark, so a new install shows no warning", () => {
  const marks = pairMarks(DEFAULTS);

  expect([sizeBytes(DEFAULTS.max_site_size) <= (marks.max_site_size?.[0]?.over ?? 0), DEFAULTS.visitor_requests_per_minute <= (marks.visitor_requests_per_minute?.[0]?.over ?? 0)]).toEqual([true, true]);
});
