import { describe, expect, test } from "bun:test";

import { parseSiteName, secretName, splitLabel } from "../src/names/names";
import { applyPrefix, DEFAULT_PREFIX, stripPrefix } from "../src/names/prefix";

const NO_RESERVED: ReadonlySet<string> = new Set();

describe("stripPrefix", () => {
  // Drift: the prefix keeps sites clear of the zone's other hostnames; a strip that guesses would serve a site at a hostname that is not one.
  test.each([
    ["page-", "page-report", { ok: true, label: "report" }],
    ["page-", "page-", { ok: true, label: "" }],
    ["page-", "report", { ok: false, refusal: "missing-prefix" }],
    ["page-", "pagereport", { ok: false, refusal: "missing-prefix" }],
    ["page-", "my-page-report", { ok: false, refusal: "missing-prefix" }],
    ["page-", "", { ok: false, refusal: "missing-prefix" }],
    ["", "report", { ok: true, label: "report" }],
    ["", "", { ok: true, label: "" }],
    ["p-", "p-report", { ok: true, label: "report" }],
  ] as const)("prefix %j on label %j", (prefix, label, outcome) => {
    expect(stripPrefix(prefix, label)).toEqual(outcome);
  });
});

describe("applyPrefix", () => {
  // Drift: links are built with one function and read with two others; if they disagree, every published link is dead.
  test.each([DEFAULT_PREFIX, "", "p-"])("a short and a secret address built with prefix %j read back to the same site", (prefix) => {
    const parsed = parseSiteName("q3-report", NO_RESERVED);
    if (!parsed.ok) throw new Error("fixture is not a site name");
    const name = parsed.value;

    const labels = [applyPrefix(prefix, name), applyPrefix(prefix, secretName(name))];
    const readBack = labels.map((label) => {
      const stripped = stripPrefix(prefix, label);
      if (!stripped.ok) return stripped;

      return splitLabel(stripped.label, NO_RESERVED);
    });

    expect({ short: labels[0], readBack }).toEqual({
      short: `${prefix}q3-report`,
      readBack: [
        { ok: true, value: { name } },
        { ok: true, value: { name, secret: expect.stringMatching(/^[0-9a-z]{12}$/) } },
      ],
    });
  });
});
