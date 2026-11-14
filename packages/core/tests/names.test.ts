import { describe, expect, test } from "bun:test";

import { nameFromEntry, parseSiteName, type SiteName, secretName, splitLabel } from "../src/names/names";

const NO_RESERVED: ReadonlySet<string> = new Set();
const RESERVED: ReadonlySet<string> = new Set(["admin"]);
const LONGEST_NAME = "a".repeat(40);
const SECRET = "7f3k9x2mq4ab";

function siteName(raw: string): SiteName {
  const parsed = parseSiteName(raw, NO_RESERVED);
  if (!parsed.ok) throw new Error(`fixture is not a site name: ${raw}`);

  return parsed.value;
}

describe("parseSiteName", () => {
  // Drift: a name becomes a DNS label and a bucket folder; a loosened rule would publish a site no hostname can reach.
  test.each([
    ["a", { ok: true, value: "a" }],
    ["report", { ok: true, value: "report" }],
    ["q3-report-2", { ok: true, value: "q3-report-2" }],
    ["7", { ok: true, value: "7" }],
    [LONGEST_NAME, { ok: true, value: LONGEST_NAME }],
    ["", { ok: false, refusal: "empty" }],
    [`${LONGEST_NAME}a`, { ok: false, refusal: "too-long" }],
    ["Report", { ok: false, refusal: "bad-character" }],
    ["my report", { ok: false, refusal: "bad-character" }],
    ["my_report", { ok: false, refusal: "bad-character" }],
    ["report.v2", { ok: false, refusal: "bad-character" }],
    ["z\u00fcrich", { ok: false, refusal: "bad-character" }],
    ["report\n", { ok: false, refusal: "bad-character" }],
    ["-report", { ok: false, refusal: "leading-dash" }],
    ["report-", { ok: false, refusal: "trailing-dash" }],
    ["-", { ok: false, refusal: "leading-dash" }],
    ["my--report", { ok: false, refusal: "double-dash" }],
    [`report--${SECRET}`, { ok: false, refusal: "double-dash" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("decides %j", (raw, outcome) => {
    expect<unknown>(parseSiteName(raw, NO_RESERVED)).toEqual(outcome);
  });

  test("the reserved set is the caller's: the same name passes or is refused by what the caller supplies", () => {
    const outcomes = [parseSiteName("admin", NO_RESERVED), parseSiteName("admin", RESERVED), parseSiteName("admins", RESERVED)];

    expect<unknown>(outcomes).toEqual([
      { ok: true, value: "admin" },
      { ok: false, refusal: "reserved" },
      { ok: true, value: "admins" },
    ]);
  });
});

describe("nameFromEntry", () => {
  // Drift: a silently rewritten name publishes at an address the user never typed, so anything past the two stated repairs must refuse.
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
    ["report-.html", { ok: false, refusal: "trailing-dash" }],
    ["a--b.html", { ok: false, refusal: "double-dash" }],
    [`${LONGEST_NAME}.html`, { ok: true, value: LONGEST_NAME }],
    [`${LONGEST_NAME}a.html`, { ok: false, refusal: "too-long" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("derives %j", (entry, outcome) => {
    expect<unknown>(nameFromEntry(entry, NO_RESERVED)).toEqual(outcome);
  });

  test("a reserved word reached through a file name is refused, so the caller must be given a name", () => {
    expect(nameFromEntry("Admin.html", RESERVED)).toEqual({ ok: false, refusal: "reserved" });
  });
});

describe("splitLabel", () => {
  // Drift: the serving path trusts this split to tell a short address from a secret one; a loose split would let one site's label resolve to another.
  test.each([
    ["report", { ok: true, value: { name: "report" } }],
    [`report--${SECRET}`, { ok: true, value: { name: "report", secret: SECRET } }],
    [`q3-report--${SECRET}`, { ok: true, value: { name: "q3-report", secret: SECRET } }],
    ["report--", { ok: false, refusal: "bad-secret" }],
    ["report--short", { ok: false, refusal: "bad-secret" }],
    [`report--${SECRET}x`, { ok: false, refusal: "bad-secret" }],
    ["report--7F3K9X2MQ4AB", { ok: false, refusal: "bad-secret" }],
    [`report--a--${SECRET}`, { ok: false, refusal: "bad-secret" }],
    [`report---${SECRET}`, { ok: false, refusal: "bad-secret" }],
    [`--${SECRET}`, { ok: false, refusal: "empty" }],
    [`Report--${SECRET}`, { ok: false, refusal: "bad-character" }],
    ["report-", { ok: false, refusal: "trailing-dash" }],
    ["", { ok: false, refusal: "empty" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("splits %j", (label, outcome) => {
    expect<unknown>(splitLabel(label, NO_RESERVED)).toEqual(outcome);
  });

  test("a reserved name is no site on either address", () => {
    const outcomes = [splitLabel("admin", RESERVED), splitLabel(`admin--${SECRET}`, RESERVED)];

    expect(outcomes).toEqual([
      { ok: false, refusal: "reserved" },
      { ok: false, refusal: "reserved" },
    ]);
  });
});

describe("secretName", () => {
  // Drift: the secret is the only thing guarding a link-state site, so its length, alphabet, and round trip are the product's promise.
  test.each(["a", "report", "q3-report-2", LONGEST_NAME])("a secret name of %j splits back to the name and 12 base36 characters", (raw) => {
    const name = siteName(raw);

    for (let round = 0; round < 200; round += 1) {
      const split = splitLabel(secretName(name), NO_RESERVED);

      expect(split).toEqual({ ok: true, value: { name, secret: expect.stringMatching(/^[0-9a-z]{12}$/) } });
    }
  });

  test("every base36 symbol is drawn and no two secrets repeat, so a constant or digits-only generator fails here", () => {
    const name = siteName("report");
    const secrets = Array.from({ length: 500 }, () => secretName(name).slice("report--".length));

    const symbols = [...new Set(secrets.join(""))].sort().join("");

    expect({ distinct: new Set(secrets).size, symbols }).toEqual({ distinct: 500, symbols: "0123456789abcdefghijklmnopqrstuvwxyz" });
  });
});
