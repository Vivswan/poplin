// How a setting's text goes into its control and comes back, how a value is written where it is only read, and where a setting with no words of its own is shown.

import { describe, expect, test } from "bun:test";

import { readOf, sentOf, shownOf } from "../../src/settings/setting-values";
import type { Row } from "../../src/settings/settings-queries";
import { groupsOf, wordsOf } from "../../src/settings/settings-words";

/** A row with nothing set that a test does not name. */
function rowOf(key: string, control: Row["control"], text: string, more: Partial<Row> = {}): Row {
  return { key: key as Row["key"], control, text, suffix: "", fallback: text, changed: false, warning: null, elsewhere: false, ...more };
}

/** A number with a unit, a number whose text ends in a suffix, a list, a switch, and plain text. */
const ROWS = {
  days: rowOf("trash_days", { kind: "number", least: 1, most: null }, "7"),
  share: rowOf("site_share_of_day", { kind: "number", least: 1, most: 100 }, "25%", { suffix: "%" }),
  logins: rowOf("logins", { kind: "lines" }, "mira@example.com,jonas@example.com"),
  check: rowOf("update_check", { kind: "switch" }, "on"),
  size: rowOf("max_total_size", { kind: "text" }, "9GB"),
};

describe("a setting's text in its control", () => {
  // Drift: a save of an untouched group would send other text than is stored, and every visit would write the settings again.
  test.each(Object.values(ROWS))("$key comes back from its control as it went in", (row) => {
    expect(sentOf(row, shownOf(row))).toBe(row.text);
  });

  // Drift: a percent would be saved without its sign and refused, or a list typed with blank lines would be refused as an empty email.
  test.each([
    [ROWS.share, " 40 ", "40%"],
    [ROWS.days, "soon", "soon"],
    [ROWS.logins, "mira@example.com\n\n jonas@example.com \n", "mira@example.com,jonas@example.com"],
    [ROWS.logins, "mira@example.com, jonas@example.com", "mira@example.com,jonas@example.com"],
    [ROWS.size, " 12GB ", "12GB"],
  ])("$key holding %j is saved as %j", (row, shown, sent) => {
    expect(sentOf(row, shown)).toBe(sent);
  });

  // Drift: a list would be shown on one line and clip its addresses, or a percent would show its sign twice beside the unit.
  test("shows a list one entry on a line and a number without its suffix", () => {
    expect([shownOf(ROWS.logins), shownOf(ROWS.share), shownOf(ROWS.size)]).toEqual(["mira@example.com\njonas@example.com", "25", "9GB"]);
  });
});

describe("a value that is only read", () => {
  // Drift: a default would read as the raw text `on` or `100000`, where the control beside it reads On and 100,000.
  test.each([
    [ROWS.check, "off", "Off"],
    [ROWS.days, "7", "7 days"],
    [rowOf("requests_per_day", { kind: "number", least: 1, most: null }, "250000"), "100000", "100,000 requests"],
    [ROWS.share, "25%", "25%"],
    [ROWS.size, "9GB", "9GB"],
    [rowOf("max_writes_per_day", { kind: "number", least: 1, most: null }, "500"), "1000", "1,000"],
  ])("$key at %j reads %j", (row, text, read) => {
    expect(readOf(row, text)).toBe(read);
  });
});

describe("a setting with no words of its own", () => {
  // Drift: a setting added to the rule book would be missing from the screen until someone wrote its words.
  test("is named from its key and shown with the limits it reads like", () => {
    const rows = [ROWS.days, rowOf("max_writes_per_day", { kind: "number", least: 1, most: null }, "500"), rowOf("night_mode", { kind: "switch" }, "off")];
    const groups = groupsOf(rows).map((group) => [group.label, group.rows.map((row) => wordsOf(row.key).label)]);

    expect(groups).toEqual([
      ["Sites", ["Days in the trash"]],
      ["Updates", []],
      ["Storage limits", ["Max writes per day"]],
      ["More", ["Night mode"]],
    ]);
  });

  // Drift: a setting that also changes the domain's rules would get a control here, and a save that the server refuses.
  test("goes with the settings changed where the domain is when the server says so", () => {
    const groups = groupsOf([rowOf("block_bots", { kind: "choice", options: ["auto", "on", "off"] }, "auto", { elsewhere: true }), ROWS.check]);

    expect(groups.map((group) => [group.id, group.rows.map((row) => row.key)])).toEqual([
      ["updates", ["update_check"]],
      ["domain", ["block_bots"]],
    ]);
  });
});
