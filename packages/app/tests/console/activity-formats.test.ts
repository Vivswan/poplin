// The Activity log as a file: how a field of the comma-separated file is written so a spreadsheet reads it as the text it is.

import { describe, expect, test } from "bun:test";

import { FILE_WRITERS, type FileEntry } from "../../src/console/activity-formats";

/** An entry with one field set, the rest plain. */
function entryWith(field: Partial<FileEntry>): FileEntry {
  return { when: "2026-11-14T09:30:00.000Z", who: "mira@example.com", what: "Logged in", site: "", title: "", action: "login", detail: {}, ...field };
}

describe("the comma-separated file", () => {
  // Drift: a spreadsheet splits a line at every comma and line break outside quotes, ends a quoted field at a lone quote, and runs a field that starts as a formula. A token's note is free text a publisher chose.
  test.each([
    ["a plain note", 'Added the token "laptop"', '"Added the token ""laptop"""'],
    ["a comma", "one, two", '"one, two"'],
    ["a line break", "one\ntwo", '"one\ntwo"'],
    ["a carriage return inside", "one\rtwo", '"one\rtwo"'],
    ["a space at an end", " padded ", '" padded "'],
    ["an equals sign first", "=1+1", "'=1+1"],
    ["a plus first", "+1", "'+1"],
    ["a minus first", "-1", "'-1"],
    ["an at sign first", "@sum", "'@sum"],
    ["a tab first", "\t=1", "'\t=1"],
    ["a formula with a quote and a comma", '=HYPERLINK("x","y")', '"\'=HYPERLINK(""x"",""y"")"'],
    ["a sign inside", "a=b-c", "a=b-c"],
    ["nothing", "", ""],
  ])("writes a field with %s so it is read back as it was", (_what, text, written) => {
    expect(FILE_WRITERS.csv.lines([entryWith({ what: text })])).toBe(`2026-11-14T09:30:00.000Z,mira@example.com,${written},,,login\r\n`);
  });
});
