import { describe, expect, test } from "bun:test";

import { type PublicName, parsePublicName, parseSiteName } from "../src/names/names";
import { applySuffix, DEFAULT_SUFFIX, parseSuffix, readHostLabel, type Suffix, stripSuffix } from "../src/names/suffix";
import { mintSiteId } from "../src/sites/ids";
import { type SiteLabel, siteLabel } from "../src/sites/labels";

const DNS_LABEL_LIMIT = 63;
const LONGEST_NAME = "a".repeat(40);
const ID = "k3f9x2ab71qz";

function suffixOf(raw: string): Suffix {
  const parsed = parseSuffix(raw);
  if (!parsed.ok) throw new Error(`fixture ${JSON.stringify(raw)} is not a suffix`);

  return parsed.value;
}

function publicNameOf(raw: string): PublicName {
  const parsed = parsePublicName(raw);
  if (!parsed.ok) throw new Error(`fixture ${JSON.stringify(raw)} is not a public name`);

  return parsed.value;
}

function labelOf(raw: string): SiteLabel {
  return siteLabel(publicNameOf(raw), mintSiteId());
}

describe("parseSuffix", () => {
  // Drift: the suffix is the one part of a hostname label the operator types, and the Worker's route is a wildcard before it; a form DNS refuses, or one a name could run into, would break every site's address at once.
  test.each([
    ["-page", { ok: true, value: "-page" }],
    ["-p", { ok: true, value: "-p" }],
    ["-my-pages", { ok: true, value: "-my-pages" }],
    ["-2", { ok: true, value: "-2" }],
    ["", { ok: false, refusal: "empty" }],
    ["-our-pages", { ok: false, refusal: "too-long" }],
    ["-Page", { ok: false, refusal: "bad-character" }],
    ["-my.page", { ok: false, refusal: "bad-character" }],
    ["-page_", { ok: false, refusal: "bad-character" }],
    ["-page\n", { ok: false, refusal: "bad-character" }],
    ["page", { ok: false, refusal: "no-leading-dash" }],
    ["page-", { ok: false, refusal: "no-leading-dash" }],
    ["-page-", { ok: false, refusal: "trailing-dash" }],
    ["-", { ok: false, refusal: "trailing-dash" }],
    ["--page", { ok: false, refusal: "double-dash" }],
    ["-my--page", { ok: false, refusal: "double-dash" }],
  ] as const)("%j", (raw, outcome) => {
    expect<unknown>(parseSuffix(raw)).toEqual(outcome);
  });

  // Drift: the default is branded where it is written, not parsed; a default that breaks the rule would be the one suffix nothing checks.
  test("the default suffix is a suffix", () => {
    expect(parseSuffix(DEFAULT_SUFFIX)).toEqual({ ok: true, value: DEFAULT_SUFFIX });
  });

  // Drift: DNS carries 63 characters in a label; if a name or an id grows, the longest allowed suffix must shrink with it.
  test("the longest suffix on the longest site label fills one DNS label and no more", () => {
    const candidates = Array.from({ length: DNS_LABEL_LIMIT }, (_, at) => `-${"p".repeat(at + 1)}`);
    const longest = candidates.filter((raw) => parseSuffix(raw).ok).at(-1) ?? "";
    const label = applySuffix(suffixOf(longest), labelOf(LONGEST_NAME));

    expect({ longerNameRefused: parseSiteName(`${LONGEST_NAME}a`).ok, suffixLength: longest.length, labelLength: label.length }).toEqual({
      longerNameRefused: false,
      suffixLength: 9,
      labelLength: DNS_LABEL_LIMIT,
    });
  });
});

describe("stripSuffix", () => {
  // Drift: the suffix keeps sites clear of the zone's other hostnames; a strip that guesses would serve a site at a hostname that is not one.
  test.each([
    ["-page", "report-page", { ok: true, label: "report" }],
    ["-page", `report--${ID}-page`, { ok: true, label: `report--${ID}` }],
    ["-page", "my-page-page", { ok: true, label: "my-page" }],
    ["-page", "-page", { ok: true, label: "" }],
    ["-page", "report", { ok: false, refusal: "not-ours" }],
    ["-page", "reportpage", { ok: false, refusal: "not-ours" }],
    ["-page", "report-page-2", { ok: false, refusal: "not-ours" }],
    ["-page", "", { ok: false, refusal: "not-ours" }],
    ["-p", "report-p", { ok: true, label: "report" }],
  ] as const)("suffix %j on label %j", (suffix, label, outcome) => {
    expect(stripSuffix(suffixOf(suffix), label)).toEqual(outcome);
  });
});

describe("applySuffix", () => {
  // Drift: `--` third and fourth is the form of an encoded name, which URL parsers refuse in any other label; the shortest names are the ones that could make it.
  test.each(["abc", "a-b", "abcd", "ab-c"])("no address of the name %j has `--` as its third and fourth characters", (raw) => {
    const labels = [DEFAULT_SUFFIX, suffixOf("-p")].flatMap((suffix) => [applySuffix(suffix, labelOf(raw)), applySuffix(suffix, publicNameOf(raw))]);

    expect(labels.filter((label) => label.startsWith("--", 2))).toEqual([]);
  });
});

describe("readHostLabel", () => {
  // Drift: links are built with `siteLabel` and `applySuffix` and read with this one function; if they disagree, every published link is dead.
  test.each([DEFAULT_SUFFIX, suffixOf("-p"), suffixOf("-my-pages")])("a site address and a public address built with suffix %j read back to the same site", (suffix) => {
    const name = publicNameOf("q3-report");
    const id = mintSiteId();
    const labels = [applySuffix(suffix, siteLabel(name, id)), applySuffix(suffix, name)];

    expect<unknown>({ labels, readBack: labels.map((label) => readHostLabel(suffix, label)) }).toEqual({
      labels: [`q3-report--${id}${suffix}`, `q3-report${suffix}`],
      readBack: [
        { kind: "site", name, id },
        { kind: "public-name", name },
      ],
    });
  });

  // Drift: this is the first thing every request meets; a label read as a site when it is not would spend a lookup on any hostname the zone receives.
  test.each([
    [`report--${ID}-page`, { kind: "site", name: "report", id: ID }],
    ["docs-page", { kind: "public-name", name: "docs" }],
    ["my-page-page", { kind: "public-name", name: "my-page" }],
    [`${ID}-page`, { kind: "public-name", name: ID }],
    ["docs", { kind: "not-ours" }],
    [`report--${ID}`, { kind: "not-ours" }],
    ["docs-pages", { kind: "not-ours" }],
    ["", { kind: "not-ours" }],
    ["-page", { kind: "not-found" }],
    ["ab-page", { kind: "not-found" }],
    ["admin-page", { kind: "public-name", name: "admin" }],
    ["gallery-page", { kind: "not-found" }],
    [`gallery--${ID}-page`, { kind: "site", name: "gallery", id: ID }],
    [`report--${ID}z-page`, { kind: "not-found" }],
    [`report---${ID}-page`, { kind: "not-found" }],
    ["report--page", { kind: "not-found" }],
    ["Docs-page", { kind: "not-found" }],
    ["docs--page", { kind: "not-found" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("reads %j", (label, outcome) => {
    expect<unknown>(readHostLabel(DEFAULT_SUFFIX, label)).toEqual(outcome);
  });
});
