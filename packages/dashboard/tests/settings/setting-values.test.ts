// How a setting's text is put into its control and read back: a number with the unit its text carries, the word of no number, a switch over two words, and a default written for reading.

import { describe, expect, test } from "bun:test";

import { isOn, partsOf, readOf, switchText, textOf } from "@/settings/setting-values";
import type { Row } from "@/settings/settings-queries";

function rowOf(key: string, control: Row["control"], more: Partial<Row> = {}): Row {
  return { key: key as Row["key"], control, text: "", unit: "", fallback: "", changed: false, warnings: [], repair: false, ...more };
}

function numberOf(key: string, unit: string, word: string | null = null): Row {
  return rowOf(key, { kind: "number", least: 1, most: null, word }, { unit });
}

describe("the text of a number", () => {
  // Drift: a field would lose the unit of the text it shows, so a default in MB put into a row stored in KB would be sent as KB; or an emptied field would be sent as a number.
  test.each([
    ["a size", numberOf("max_total_size", "MB"), "9000MB", { count: 9000, unit: "MB" }],
    ["a share", numberOf("site_share_of_day", "%"), "25%", { count: 25, unit: "%" }],
    ["a plain count", numberOf("trash_days", ""), "7", { count: 7, unit: "" }],
    ["a text in another unit than the row's", numberOf("max_site_size", "KB"), "200MB", { count: 200, unit: "MB" }],
    ["an emptied field, which keeps its unit", numberOf("max_total_size", "MB"), "MB", { count: null, unit: "MB" }],
    ["an emptied field whose empty means the word", numberOf("max_sites", "", "none"), "none", { count: null, unit: "" }],
  ])("of %s is taken apart and read back unchanged", (_what, row, text, parts) => {
    expect([partsOf(row, text), textOf(row, parts)]).toEqual([parts, text]);
  });

  // Drift: the word of a setting that has its own choice for it would come back from an emptied field, so clearing the days would silently choose Never.
  test("of an emptied field is the unit alone where the word has a choice of its own, and the unit of the row once a number follows the word", () => {
    const expires = numberOf("default_expires", "d", "never");

    expect([textOf(expires, { count: null, unit: "d" }), partsOf(expires, "never"), textOf(expires, { count: 30, unit: "d" })]).toEqual(["d", { count: null, unit: "d" }, "30d"]);
  });
});

describe("a switch", () => {
  // Drift: a choice between two words drawn as a switch would send on or off, which its setting does not take.
  test.each([
    ["an on or off", rowOf("update_check", { kind: "switch" }), ["on", "off"]],
    ["a choice of two whose words name the one that is on", rowOf("outside_pages", { kind: "choice", options: ["blocked", "allowed"] }), ["allowed", "blocked"]],
  ])("over %s sends the setting's own two texts", (_what, row, [on = "", off = ""]) => {
    expect([switchText(row, true), switchText(row, false), isOn(row, on), isOn(row, off)]).toEqual([on, off, true, false]);
  });
});

describe("a value that is only read", () => {
  // Drift: a default would be shown as the raw text of the setting, such as `9000MB`, `off`, `auto`, or `never`.
  test.each([
    [rowOf("update_check", { kind: "switch" }), "on", "On"],
    [rowOf("outside_pages", { kind: "choice", options: ["blocked", "allowed"] }), "blocked", "Off"],
    [rowOf("block_bots", { kind: "choice", options: ["auto", "on", "off"] }), "auto", "Automatic"],
    [numberOf("max_total_size", "MB"), "9000MB", "9,000 MB"],
    [numberOf("site_share_of_day", "%"), "25%", "25%"],
    [numberOf("requests_per_day", ""), "100000", "100,000 requests"],
    [numberOf("default_expires", "d", "never"), "never", "Never"],
    [numberOf("default_expires", "h", "never"), "12h", "12 hours"],
    [numberOf("max_sites", "", "none"), "none", "No limit"],
    [rowOf("a_new_text", { kind: "text" }), "as it is", "as it is"],
  ])("%#: %o with %s reads %s", (row, text, read) => {
    expect(readOf(row, text)).toBe(read);
  });
});
