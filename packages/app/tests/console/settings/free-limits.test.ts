import { expect, test } from "bun:test";

import { defaultSettings, type SettingValues } from "@poplin/core/src/records/settings";

import { freeLimitWarnings } from "../../../src/console/settings/free-limits";
import { FREE_LIMITS } from "../support/install";

const DEFAULTS = defaultSettings({ installer: "owner@example.com" as SettingValues["logins"][number], hostname: "poplin.example.com" });

function logins(count: number): SettingValues["logins"] {
  return Array.from(Array(count).keys(), (index) => `user${index}@example.com`) as SettingValues["logins"];
}

test("the defaults are inside every limit of the free plan, so a new install shows no warning", () => {
  expect([...freeLimitWarnings(DEFAULTS, FREE_LIMITS)]).toEqual([]);
});

test("a value at a free limit earns no warning and a value above it earns that setting's sentence, one for each limit it is above", () => {
  const cases: readonly [Partial<SettingValues>, readonly (readonly [string, string])[]][] = [
    [{ max_total_size: { count: 10, unit: "GB" } }, []],
    [{ max_total_size: { count: 10_000, unit: "MB" } }, []],
    [{ max_total_size: { count: 11, unit: "GB" } }, [["max_total_size", "all sites are above the free 10 GB"]]],
    [{ max_total_size: { count: 10_001, unit: "MB" } }, [["max_total_size", "all sites are above the free 10 GB"]]],
    [{ max_site_size: { count: 10, unit: "GB" } }, []],
    [{ max_site_size: { count: 11, unit: "GB" } }, [["max_site_size", "one site is above the free 10 GB"]]],
    [{ max_files_per_publish: 5000, max_files_per_day: 32_000 }, []],
    [{ max_files_per_publish: 5001 }, [["max_files_per_publish", "one publish is above the free 5,000 files"]]],
    [{ max_files_per_day: 32_001 }, [["max_files_per_day", "above the free 32,000 files a day"]]],
    [{ requests_per_day: 100_000 }, []],
    [{ requests_per_day: 100_001 }, [["requests_per_day", "above the free 100,000 requests a day"]]],
    [{ logins: logins(50) }, []],
    [{ logins: logins(51) }, [["logins", "above the free 50 users"]]],
    [{ max_sites: 1_000_000, versions_kept: 500, trash_days: 9999, site_requests_per_minute: 1_000_000 }, []],
    [
      { max_total_size: { count: 20, unit: "GB" }, requests_per_day: 250_000 },
      [
        ["max_total_size", "all sites are above the free 10 GB"],
        ["requests_per_day", "above the free 10,000,000 reads a month; above the free 100,000 requests a day"],
      ],
    ],
  ];

  for (const [changes, warnings] of cases) expect<unknown>([changes, [...freeLimitWarnings({ ...DEFAULTS, ...changes }, FREE_LIMITS)]]).toEqual([changes, warnings]);
});
