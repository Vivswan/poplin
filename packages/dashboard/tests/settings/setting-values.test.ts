// How a setting's text is put into its control and read back where the source cannot say it alone: the unit a text carries against the unit of its row, and a default written for reading.

import { describe, expect, test } from "bun:test";

import { partsOf, readOf, textOf } from "@/settings/setting-values";
import type { Row } from "@/settings/settings-queries";

function numberOf(key: string, unit: string, word: string | null = null): Row {
  return { key: key as Row["key"], control: { kind: "number", word }, text: "", unit, fallback: "", warnings: [], repair: false };
}

describe("the text of a number", () => {
  // Drift: a default in MB put into a row stored in KB would be sent as KB, or an emptied field would lose its unit, so the next count typed would be sent with none.
  test.each([
    ["a text in another unit than the row's", numberOf("max_site_size", "KB"), "200MB", { count: 200, unit: "MB" }],
    ["an emptied field, which keeps its unit", numberOf("max_total_size", "MB"), "MB", { count: null, unit: "MB" }],
  ])("of %s is taken apart and read back unchanged", (_what, row, text, parts) => {
    expect([partsOf(row, text), textOf(row, parts)]).toEqual([parts, text]);
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
