// How a setting's text is put into its control and read back where the source cannot say it alone: the unit a text carries against the unit of its row, and a default written for reading.

import { describe, expect, test } from "bun:test";

import { boundedBy, partsOf, readOf, textOf } from "@/settings/setting-values";
import type { Row } from "@/settings/settings-queries";

function numberOf(key: string, unit: string, word: string | null = null): Row {
  return { key: key as Row["key"], control: { kind: "number", word }, text: "", unit, fallback: "", limits: [], repair: false, needs: null };
}

describe("the text of a number", () => {
  // Drift: a default in MB put into a row stored in KB would be sent as KB, or an emptied field would lose its unit, so the next count typed would be sent with none.
  test.each([
    ["a text in another unit than the row's", numberOf("max_site_size", "KB"), "200MB", { count: 200, unit: "MB" }],
    ["an emptied field, which keeps its unit", numberOf("max_total_size", "MB"), "MB", { count: null, unit: "MB" }],
    ["a count with a fraction, which stays in the count", numberOf("max_total_size", "MB"), "1.5MB", { count: 1.5, unit: "MB" }],
    ["a fraction a number writes with an exponent, which the text writes in digits", numberOf("max_total_size", "MB"), "0.0000001MB", { count: 1e-7, unit: "MB" }],
    ["a count below 0, whose minus stays in the count and out of the unit", numberOf("max_total_size", "MB"), "-5MB", { count: -5, unit: "MB" }],
  ])("of %s is taken apart and read back unchanged", (_what, row, text, parts) => {
    expect([partsOf(row, text), textOf(row, parts)]).toEqual([parts, text]);
  });
});

describe("a limit bounded by another setting", () => {
  const WARNING = "More than the other, so that limit is reached first.";
  const boundedRow = (unit: string, bound: NonNullable<Row["limits"][number]["bound"]>, over: number): Row => {
    const key = bound.key === "max_total_size" ? "max_site_size" : "visitor_requests_per_minute";

    return { ...numberOf(key, unit), limits: [{ over, unit, warning: WARNING, bound }] };
  };

  // Drift: the mark the server sends is the bound as it was saved. With one visitor at 600 a minute, a site lowered from 6,000 to 100 in its field would show no warning until Save, and a size would be compared count by count across two units.
  test.each([
    ["a count, against the count typed into the bounding field", boundedRow("", { key: "site_requests_per_minute", per: 1, times: { "": 1 } }, 6000), numberOf("site_requests_per_minute", ""), "100", 100],
    ["a size in MB, against a bounding size typed in MB", boundedRow("MB", { key: "max_total_size", per: 1_000_000, times: { MB: 1_000_000 } }, 9000), numberOf("max_total_size", "MB"), "150MB", 150],
    ["a size in KB, against a bounding size typed in MB", boundedRow("KB", { key: "max_total_size", per: 1000, times: { MB: 1_000_000 } }, 9_000_000), numberOf("max_total_size", "MB"), "150MB", 150_000],
    ["a size in KB, against a bounding size typed with a fraction", boundedRow("KB", { key: "max_total_size", per: 1000, times: { MB: 1_000_000 } }, 9_000_000), numberOf("max_total_size", "MB"), "1.001MB", 1001],
    ["the saved bound, while the bounding field holds no number", boundedRow("", { key: "site_requests_per_minute", per: 1, times: { "": 1 } }, 6000), numberOf("site_requests_per_minute", ""), "", 6000],
    ["the saved bound, under a unit the server sent no size of", boundedRow("MB", { key: "max_total_size", per: 1_000_000, times: { MB: 1_000_000 } }, 9000), numberOf("max_total_size", "MB"), "150GB", 9000],
  ])("is marked at %s", (_what, row, bounding, typed, over) => {
    expect(boundedBy(row, [row, bounding], (shown) => (shown.key === bounding.key ? typed : "")).limits.map((limit) => limit.over)).toEqual([over]);
  });
});

describe("a value that is only read", () => {
  // Drift: a default would be shown without separators or without its unit's word, such as `9000MB` or `12h`.
  test.each([
    [numberOf("max_total_size", "MB"), "9000MB", "9,000 MB"],
    [numberOf("site_share_of_day", "%"), "25%", "25%"],
    [numberOf("requests_per_day", ""), "100000", "100,000 requests"],
    [numberOf("default_expires", "h", "never"), "12h", "12 hours"],
  ])("%#: %o with %s reads %s", (row, text, read) => {
    expect(readOf(row, text)).toBe(read);
  });
});
