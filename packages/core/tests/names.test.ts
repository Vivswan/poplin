import { describe, expect, test } from "bun:test";

import { nameFromEntry, parsePublicName, parseSiteName } from "../src/names/names";

const NO_OWN_NAMES: ReadonlySet<string> = new Set();
const OWN_NAMES: ReadonlySet<string> = new Set(["admin"]);
const LONGEST_NAME = "a".repeat(40);

describe("parseSiteName", () => {
  // Drift: a name is part of a DNS label; a loosened rule would publish a site no hostname can reach, and a name under 3 characters would put `--` third and fourth.
  test.each([
    ["abc", { ok: true, value: "abc" }],
    ["report", { ok: true, value: "report" }],
    ["q3-report-2", { ok: true, value: "q3-report-2" }],
    ["777", { ok: true, value: "777" }],
    ["k3f9x2ab71qz", { ok: true, value: "k3f9x2ab71qz" }],
    ["gallery", { ok: true, value: "gallery" }],
    ["publish", { ok: true, value: "publish" }],
    [LONGEST_NAME, { ok: true, value: LONGEST_NAME }],
    ["", { ok: false, refusal: "empty" }],
    ["a", { ok: false, refusal: "too-short" }],
    ["ab", { ok: false, refusal: "too-short" }],
    [`${LONGEST_NAME}a`, { ok: false, refusal: "too-long" }],
    ["Report", { ok: false, refusal: "bad-character" }],
    ["my report", { ok: false, refusal: "bad-character" }],
    ["my_report", { ok: false, refusal: "bad-character" }],
    ["report.v2", { ok: false, refusal: "bad-character" }],
    ["z\u00fcrich", { ok: false, refusal: "bad-character" }],
    ["report\n", { ok: false, refusal: "bad-character" }],
    ["-report", { ok: false, refusal: "leading-dash" }],
    ["report-", { ok: false, refusal: "trailing-dash" }],
    ["---", { ok: false, refusal: "leading-dash" }],
    ["my--report", { ok: false, refusal: "double-dash" }],
    ["report--k3f9x2ab71qz", { ok: false, refusal: "double-dash" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("decides %j", (raw, outcome) => {
    expect<unknown>(parseSiteName(raw)).toEqual(outcome);
  });
});

describe("nameFromEntry", () => {
  // Drift: a silently rewritten name publishes under a name the user never typed, so anything past the two stated repairs must refuse.
  test.each([
    ["report.html", { ok: true, value: "report" }],
    ["Q3-Report.HTML", { ok: true, value: "q3-report" }],
    ["site", { ok: true, value: "site" }],
    ["My Report.html", { ok: false, refusal: "bad-character" }],
    ["report.htm", { ok: false, refusal: "bad-character" }],
    ["report.html.html", { ok: false, refusal: "bad-character" }],
    ["docs/report.html", { ok: false, refusal: "bad-character" }],
    ["\u212Aelvin.html", { ok: false, refusal: "bad-character" }],
    [".html", { ok: false, refusal: "empty" }],
    ["ab.html", { ok: false, refusal: "too-short" }],
    ["report-.html", { ok: false, refusal: "trailing-dash" }],
    ["a--b.html", { ok: false, refusal: "double-dash" }],
    [`${LONGEST_NAME}.html`, { ok: true, value: LONGEST_NAME }],
    [`${LONGEST_NAME}a.html`, { ok: false, refusal: "too-long" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("derives %j", (entry, outcome) => {
    expect<unknown>(nameFromEntry(entry)).toEqual(outcome);
  });
});

describe("parsePublicName", () => {
  // Drift: a public name before the suffix is a whole hostname label, so it must not be one the install answers on itself; a name with an id behind it never is, and stays free.
  test.each([
    ["docs", { ok: true, value: "docs" }],
    ["admins", { ok: true, value: "admins" }],
    ["publish", { ok: true, value: "publish" }],
    ["none", { ok: true, value: "none" }],
    ["gallery", { ok: false, refusal: "reserved" }],
    ["admin", { ok: false, refusal: "reserved" }],
    ["ab", { ok: false, refusal: "too-short" }],
    ["my--docs", { ok: false, refusal: "double-dash" }],
    ["Gallery", { ok: false, refusal: "bad-character" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("decides %j", (raw, outcome) => {
    expect<unknown>(parsePublicName(raw, OWN_NAMES)).toEqual(outcome);
  });

  test("drift: `gallery` is every install's own, and the rest of the set is the caller's", () => {
    expect<unknown>([parsePublicName("gallery", NO_OWN_NAMES), parsePublicName("admin", NO_OWN_NAMES)]).toEqual([
      { ok: false, refusal: "reserved" },
      { ok: true, value: "admin" },
    ]);
  });
});
