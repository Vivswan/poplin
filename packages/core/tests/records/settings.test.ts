// This pins the published defaults: the table of install settings in the CLI reference is a promise to every install, and the code is its only other copy.

import { describe, expect, test } from "bun:test";
import * as v from "valibot";

import type { Login } from "../../src/auth/logins";
import { defaultSettings, SETTING_VALUES, type SettingValues, settingsFromText, settingsToText, showBytes, sizeBytes } from "../../src/records/settings";

const INSTALL = { installer: "ada@example.com" as Login, hostname: "poplin.example.com" };
const PUBLISHED_DEFAULTS = {
  default_expires: "never",
  default_search_engines: "off",
  versions_kept: "3",
  trash_days: "7",
  logins: "ada@example.com",
  dashboard_title: "poplin.example.com",
  outside_pages: "blocked",
  search_engines_allowed: "off",
  block_bots: "auto",
  max_total_size: "9GB",
  max_site_size: "200MB",
  max_sites: "none",
  max_files_per_publish: "5000",
  max_files_per_day: "25000",
  requests_per_day: "100000",
  site_share_of_day: "25%",
  site_requests_per_minute: "6000",
  visitor_requests_per_minute: "600",
  update_check: "on",
};
const CHANGED = {
  default_expires: "7d",
  default_search_engines: "on",
  versions_kept: "10",
  trash_days: "30",
  logins: "ada@example.com,bo@example.com",
  dashboard_title: "Team pages",
  outside_pages: "allowed",
  search_engines_allowed: "on",
  block_bots: "off",
  max_total_size: "1500MB",
  max_site_size: "512KB",
  max_sites: "40",
  max_files_per_publish: "10000",
  max_files_per_day: "60000",
  requests_per_day: "5000",
  site_share_of_day: "100%",
  site_requests_per_minute: "1",
  visitor_requests_per_minute: "2",
  update_check: "off",
};
const CHANGED_VALUES = {
  default_expires: { count: 7, unit: "d" },
  default_search_engines: true,
  versions_kept: 10,
  trash_days: 30,
  logins: ["ada@example.com", "bo@example.com"],
  dashboard_title: "Team pages",
  outside_pages: "allowed",
  search_engines_allowed: true,
  block_bots: "off",
  max_total_size: { count: 1500, unit: "MB" },
  max_site_size: { count: 512, unit: "KB" },
  max_sites: 40,
  max_files_per_publish: 10_000,
  max_files_per_day: 60_000,
  requests_per_day: 5000,
  site_share_of_day: 100,
  site_requests_per_minute: 1,
  visitor_requests_per_minute: 2,
  update_check: false,
};

describe("defaultSettings", () => {
  test("drift: the defaults a new install gets are the published table, key for key and in its order", () => {
    const texts = settingsToText(defaultSettings(INSTALL));

    expect(Object.entries(texts)).toEqual(Object.entries(PUBLISHED_DEFAULTS));
    expect(v.is(SETTING_VALUES, defaultSettings(INSTALL))).toBe(true);
  });
});

describe("settingsFromText and settingsToText", () => {
  test("drift: what an admin types must come back as typed when shown, or `poplin config` would show a setting nobody set", () => {
    const read = [PUBLISHED_DEFAULTS, CHANGED].map((texts) => settingsFromText(texts));

    expect<unknown>(read).toEqual([
      { ok: true, values: defaultSettings(INSTALL) },
      { ok: true, values: CHANGED_VALUES },
    ]);
    expect(read.map((settings) => settings.ok && settingsToText(settings.values))).toEqual([PUBLISHED_DEFAULTS, CHANGED]);
  });

  // Drift: a unit an admin may type must come back as typed; a printer that picked its own unit would show `2h` for a typed `120m`.
  test.each([
    ["default_expires", "120s"],
    ["default_expires", "2m"],
    ["default_expires", "24h"],
    ["default_expires", "7d"],
    ["default_expires", "36h"],
    ["max_site_size", "1000KB"],
    ["max_site_size", "1500B"],
  ])("reads %s %j and prints it back unchanged", (key, typed) => {
    const read = settingsFromText({ ...PUBLISHED_DEFAULTS, [key]: typed });

    expect(read.ok && settingsToText(read.values)[key as keyof SettingValues]).toBe(typed);
  });

  test("drift: a login is compared in its normal form, so the list is stored and shown that way however it was typed", () => {
    const read = settingsFromText({ ...PUBLISHED_DEFAULTS, logins: " Ada@Example.com ,bo@example.com" });

    expect(read.ok && settingsToText(read.values).logins).toBe("ada@example.com,bo@example.com");
  });

  // Drift: a setting is typed by a person; each row is text that must be refused by its key, never stored as some nearby value.
  test.each([
    ["default_expires", "60", "bad-form"],
    ["default_expires", "60 s", "bad-form"],
    ["default_expires", "1.5m", "bad-form"],
    ["default_expires", "-60s", "bad-form"],
    ["default_expires", "60S", "bad-form"],
    ["default_expires", "9GB", "bad-form"],
    ["default_expires", "off", "bad-form"],
    ["default_expires", "0s", "out-of-range"],
    ["max_total_size", "9gb", "bad-form"],
    ["max_total_size", "9GiB", "bad-form"],
    ["max_total_size", "0GB", "out-of-range"],
    ["max_total_size", "99999999999GB", "out-of-range"],
    ["site_share_of_day", "25", "bad-form"],
    ["site_share_of_day", "0%", "out-of-range"],
    ["site_share_of_day", "101%", "out-of-range"],
    ["versions_kept", "0", "out-of-range"],
    ["versions_kept", "03", "bad-form"],
    ["versions_kept", "three", "bad-form"],
    ["trash_days", "0", "out-of-range"],
    ["max_sites", "0", "out-of-range"],
    ["max_sites", "unlimited", "bad-form"],
    ["default_expires", "0d", "out-of-range"],
    ["default_expires", "2026-12-01", "bad-form"],
    ["default_search_engines", "true", "bad-form"],
    ["search_engines_allowed", "ON", "bad-form"],
    ["outside_pages", "on", "bad-form"],
    ["search_engines_allowed", "allowed", "bad-form"],
    ["block_bots", "blocked", "bad-form"],
    ["block_bots", "Auto", "bad-form"],
    ["dashboard_title", "", "out-of-range"],
    ["logins", "", "bad-form"],
    ["logins", "ada@example.com,", "bad-form"],
    ["logins", "ada@example.com,ADA@example.com", "out-of-range"],
    ["default_access", "public", "unknown-key"],
  ])("refuses %s %j as %s", (key, text, refusal) => {
    expect<unknown>(settingsFromText({ ...PUBLISHED_DEFAULTS, [key]: text })).toEqual({ ok: false, key, refusal });
  });

  test("drift: a change is checked against every key, so a setting left out is named instead of silently keeping an unknown value", () => {
    const { trash_days: _, ...rest } = PUBLISHED_DEFAULTS;

    expect<unknown>(settingsFromText(rest)).toEqual({ ok: false, key: "trash_days", refusal: "missing" });
  });
});

describe("SETTING_VALUES", () => {
  // Drift: the settings are read on every request; each row is a stored value that would switch a limit off or lock every admin out.
  test.each([
    ["the last login cannot be removed", { logins: [] }, "logins"],
    ["a login is an email in its normal form", { logins: ["Ada@Example.com"] }, "logins.0"],
    ["a duration is stored as a count and its unit, not as the text typed", { default_expires: "60s" }, "default_expires"],
    ["a duration's unit is one of the four", { default_expires: { count: 1, unit: "w" } }, "default_expires"],
    ["a size is a whole count", { max_site_size: { count: 1.5, unit: "MB" } }, "max_site_size.count"],
    ["no limit on sites is the word none, never null", { max_sites: null }, "max_sites"],
    ["no key beyond the published ones", { default_access: "public" }, "default_access"],
  ])("refuses settings that break: %s", (_, change, field) => {
    const checked = v.safeParse(SETTING_VALUES, { ...defaultSettings(INSTALL), ...change });

    expect(checked.success ? undefined : v.getDotPath(checked.issues[0])).toBe(field);
  });
});

describe("showBytes", () => {
  // Drift: the dashboard and the CLI show a size against a limit typed as `9GB`; a binary unit or another rounding would show a full install as one with room.
  test.each([
    [0, "0 B"],
    [999, "999 B"],
    [1000, "1 KB"],
    [1500, "1.5 KB"],
    [1_250_000, "1.3 MB"],
    [1_449_999, "1.4 MB"],
    [999_949, "999.9 KB"],
    [999_950, "1 MB"],
    [200_000_000, "200 MB"],
    [sizeBytes({ count: 9, unit: "GB" }), "9 GB"],
    [12_345_678_901, "12.3 GB"],
    [1_000_000_000_000, "1000 GB"],
  ])("%d bytes are shown as %s", (bytes, shown) => {
    expect(showBytes(bytes)).toBe(shown);
  });
});
