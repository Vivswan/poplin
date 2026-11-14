// This pins the published defaults: the table of install settings in the CLI reference is a promise to every install, and the code is its only other copy.

import { describe, expect, test } from "bun:test";
import * as v from "valibot";

import type { Login } from "../src/auth/logins";
import { defaultSettings, SETTING_VALUES, type SettingValues, settingsFromText, settingsToText } from "../src/records/settings";

const INSTALL = { installer: "ada@example.com" as Login, hostname: "admin.example.com" };
const PUBLISHED_DEFAULTS = {
  default_expires: "never",
  default_search_engines: "off",
  versions_kept: "3",
  trash_days: "7",
  logins: "ada@example.com",
  dashboard_title: "admin.example.com",
  gallery: "off",
  cache_html: "60s",
  cache_files: "1h",
  private_sites: "single-file",
  outside_pages: "blocked",
  search_engines_allowed: "off",
  zone_bots: "auto",
  max_total_size: "9GB",
  max_site_size: "200MB",
  max_sites: "none",
  requests_per_day: "100000",
  site_share_of_day: "25%",
  site_requests_per_minute: "60",
  visitor_requests_per_minute: "30",
};
const CHANGED = {
  default_expires: "7d",
  default_search_engines: "on",
  versions_kept: "10",
  trash_days: "30",
  logins: "ada@example.com,bo@example.com",
  dashboard_title: "Team pages",
  gallery: "on",
  cache_html: "0s",
  cache_files: "off",
  private_sites: "folders",
  outside_pages: "allowed",
  search_engines_allowed: "on",
  zone_bots: "off",
  max_total_size: "1500MB",
  max_site_size: "512KB",
  max_sites: "40",
  requests_per_day: "5000",
  site_share_of_day: "100%",
  site_requests_per_minute: "1",
  visitor_requests_per_minute: "2",
};
const CHANGED_VALUES = {
  default_expires: { count: 7, unit: "d" },
  default_search_engines: true,
  versions_kept: 10,
  trash_days: 30,
  logins: ["ada@example.com", "bo@example.com"],
  dashboard_title: "Team pages",
  gallery: true,
  cache_html: { count: 0, unit: "s" },
  cache_files: "off",
  private_sites: "folders",
  outside_pages: "allowed",
  search_engines_allowed: true,
  zone_bots: "off",
  max_total_size: { count: 1500, unit: "MB" },
  max_site_size: { count: 512, unit: "KB" },
  max_sites: 40,
  requests_per_day: 5000,
  site_share_of_day: 100,
  site_requests_per_minute: 1,
  visitor_requests_per_minute: 2,
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

  // Drift: a unit an admin may type must come back as typed; a printer that picked its own unit would show `1m` for the published `60s`.
  test.each([
    ["cache_html", "120s"],
    ["cache_html", "2m"],
    ["cache_html", "24h"],
    ["cache_files", "7d"],
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
    ["cache_html", "60", "bad-form"],
    ["cache_html", "60 s", "bad-form"],
    ["cache_html", "1.5m", "bad-form"],
    ["cache_html", "-60s", "bad-form"],
    ["cache_html", "60S", "bad-form"],
    ["cache_html", "9GB", "bad-form"],
    ["cache_files", "never", "bad-form"],
    ["cache_files", "0s", "out-of-range"],
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
    ["gallery", "ON", "bad-form"],
    ["private_sites", "folder", "bad-form"],
    ["outside_pages", "on", "bad-form"],
    ["search_engines_allowed", "allowed", "bad-form"],
    ["zone_bots", "blocked", "bad-form"],
    ["zone_bots", "Auto", "bad-form"],
    ["dashboard_title", "", "out-of-range"],
    ["logins", "", "bad-form"],
    ["logins", "ada@example.com,", "bad-form"],
    ["logins", "ada@example.com,ADA@example.com", "out-of-range"],
    ["default_access", "public", "unknown-key"],
  ])("refuses %s %j as %s", (key, text, refusal) => {
    expect<unknown>(settingsFromText({ ...PUBLISHED_DEFAULTS, [key]: text })).toEqual({ ok: false, key, refusal });
  });

  test("drift: a change is checked against every key, so a setting left out is named instead of silently keeping an unknown value", () => {
    const { gallery: _, ...rest } = PUBLISHED_DEFAULTS;

    expect<unknown>(settingsFromText(rest)).toEqual({ ok: false, key: "gallery", refusal: "missing" });
  });
});

describe("SETTING_VALUES", () => {
  // Drift: the settings are read on every request; each row is a stored value that would switch a limit off or lock every admin out.
  test.each([
    ["the last login cannot be removed", { logins: [] }, "logins"],
    ["a login is an email in its normal form", { logins: ["Ada@Example.com"] }, "logins.0"],
    ["a duration is stored as a count and its unit, not as the text typed", { cache_html: "60s" }, "cache_html"],
    ["a duration's unit is one of the four", { cache_html: { count: 1, unit: "w" } }, "cache_html.unit"],
    ["a size is a whole count", { max_site_size: { count: 1.5, unit: "MB" } }, "max_site_size.count"],
    ["no limit on sites is the word none, never null", { max_sites: null }, "max_sites"],
    ["no key beyond the published ones", { default_access: "public" }, "default_access"],
  ])("refuses settings that break: %s", (_, change, field) => {
    const checked = v.safeParse(SETTING_VALUES, { ...defaultSettings(INSTALL), ...change });

    expect(checked.success ? undefined : v.getDotPath(checked.issues[0])).toBe(field);
  });
});
