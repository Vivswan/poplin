import { describe, expect, test } from "bun:test";

import { parseSiteName, type SiteName, secretName, splitLabel } from "../src/names/names";
import { applyPrefix, DEFAULT_PREFIX, type Prefix, parsePrefix, stripPrefix } from "../src/names/prefix";

const NO_RESERVED: ReadonlySet<string> = new Set();
const DNS_LABEL_LIMIT = 63;
const LONGEST_NAME = "a".repeat(40);

function prefixOf(raw: string): Prefix {
  const parsed = parsePrefix(raw);
  if (!parsed.ok) throw new Error(`fixture ${JSON.stringify(raw)} is not a prefix`);

  return parsed.value;
}

function siteNameOf(raw: string): SiteName {
  const parsed = parseSiteName(raw, NO_RESERVED);
  if (!parsed.ok) throw new Error(`fixture ${JSON.stringify(raw)} is not a site name`);

  return parsed.value;
}

describe("parsePrefix", () => {
  // Drift: a prefix is the one part of a hostname label the operator types; a character or a length DNS refuses would break every site's address at once.
  test.each([
    ["page-", { ok: true, value: "page-" }],
    ["", { ok: true, value: "" }],
    ["p", { ok: true, value: "p" }],
    ["my--2-", { ok: true, value: "my--2-" }],
    ["internal-pages-", { ok: false, refusal: "too-long" }],
    ["Page-", { ok: false, refusal: "bad-character" }],
    ["my.page-", { ok: false, refusal: "bad-character" }],
    ["page_", { ok: false, refusal: "bad-character" }],
    ["page-\n", { ok: false, refusal: "bad-character" }],
    ["-page-", { ok: false, refusal: "leading-dash" }],
    ["-", { ok: false, refusal: "leading-dash" }],
  ] as const)("%j", (raw, outcome) => {
    expect<unknown>(parsePrefix(raw)).toEqual(outcome);
  });

  // Drift: the default is branded where it is written, not parsed; a default that breaks the rule would be the one prefix nothing checks.
  test("the default prefix is a prefix", () => {
    expect(parsePrefix(DEFAULT_PREFIX)).toEqual({ ok: true, value: DEFAULT_PREFIX });
  });

  // Drift: DNS carries 63 characters in a label; if a name or a secret grows, the longest allowed prefix must shrink with it.
  test("the longest prefix on the longest secret name fills one DNS label and no more", () => {
    const longestPrefix = "p".repeat(DNS_LABEL_LIMIT);
    const lengths = Array.from(longestPrefix, (_, at) => longestPrefix.slice(0, at + 1));
    const accepted = lengths.filter((raw) => parsePrefix(raw).ok);
    const label = applyPrefix(prefixOf(accepted.at(-1) ?? ""), secretName(siteNameOf(LONGEST_NAME)));

    expect({ longerNameRefused: parseSiteName(`${LONGEST_NAME}a`, NO_RESERVED).ok, labelLength: label.length }).toEqual({
      longerNameRefused: false,
      labelLength: DNS_LABEL_LIMIT,
    });
  });
});

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
    expect(stripPrefix(prefixOf(prefix), label)).toEqual(outcome);
  });
});

describe("applyPrefix", () => {
  // Drift: links are built with one function and read with two others; if they disagree, every published link is dead.
  test.each([DEFAULT_PREFIX, prefixOf(""), prefixOf("p-")])("a short and a secret address built with prefix %j read back to the same site", (prefix) => {
    const name = siteNameOf("q3-report");

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
