import { expect, test } from "bun:test";

import { defaultSettings, type SettingValues } from "@poplin/core/src/records/settings";

import { freeLimitWarnings } from "../../../src/dashboard/settings/free-limits";

const DEFAULTS = defaultSettings({ installer: "owner@example.com" as SettingValues["logins"][number], hostname: "admin.example.com" });

function logins(count: number): SettingValues["logins"] {
  return Array.from(Array(count).keys(), (index) => `user${index}@example.com`) as SettingValues["logins"];
}

test("the defaults are inside every free limit of Cloudflare, so a new install shows no warning", () => {
  expect([...freeLimitWarnings(DEFAULTS)]).toEqual([]);
});

test("a value at a free limit earns no warning and a value above it earns that setting's one sentence", () => {
  const cases: readonly [Partial<SettingValues>, readonly (readonly [string, string])[]][] = [
    [{ max_total_size: { count: 10, unit: "GB" } }, []],
    [{ max_total_size: { count: 10_000, unit: "MB" } }, []],
    [{ max_total_size: { count: 11, unit: "GB" } }, [["max_total_size", "above Cloudflare's free 10 GB; storage past that is billed by Cloudflare"]]],
    [{ max_total_size: { count: 10_001, unit: "MB" } }, [["max_total_size", "above Cloudflare's free 10 GB; storage past that is billed by Cloudflare"]]],
    [{ max_site_size: { count: 10, unit: "GB" } }, []],
    [{ max_site_size: { count: 11, unit: "GB" } }, [["max_site_size", "one site of this size is above Cloudflare's free 10 GB; storage past that is billed by Cloudflare"]]],
    [{ requests_per_day: 100_000 }, []],
    [{ requests_per_day: 100_001 }, [["requests_per_day", "above Cloudflare's free 100,000 requests a day; has no effect without the paid Workers plan"]]],
    [{ logins: logins(50) }, []],
    [{ logins: logins(51) }, [["logins", "above the 50 users Cloudflare Access takes for free; users past that are billed by Cloudflare"]]],
    [{ max_sites: 1_000_000, versions_kept: 500, trash_days: 9999, site_requests_per_minute: 1_000_000 }, []],
    [
      { max_total_size: { count: 20, unit: "GB" }, requests_per_day: 250_000 },
      [
        ["max_total_size", "above Cloudflare's free 10 GB; storage past that is billed by Cloudflare"],
        ["requests_per_day", "above Cloudflare's free 100,000 requests a day; has no effect without the paid Workers plan"],
      ],
    ],
  ];

  for (const [changes, warnings] of cases) expect<unknown>([changes, [...freeLimitWarnings({ ...DEFAULTS, ...changes })]]).toEqual([changes, warnings]);
});
