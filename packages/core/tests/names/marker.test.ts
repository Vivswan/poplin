import { describe, expect, test } from "bun:test";

import { DEFAULT_PUBLIC_WORD, keptPublicNames, type PublicWord, parsePublicWord, publicHostLabel, readHostLabel, siteHostLabel } from "../../src/names/marker";
import { type PublicName, parsePublicName, parseSiteName } from "../../src/names/names";
import { mintSiteId } from "../../src/sites/ids";
import { type SiteLabel, siteLabel } from "../../src/sites/labels";

const DNS_LABEL_LIMIT = 63;
const LONGEST_NAME = "a".repeat(40);
const LONGEST_WORD = "publishes" as PublicWord;
const ID = "k3f9x2ab71qz";
const OWN: ReadonlySet<string> = new Set(["gallery"]);
const PAGE = { publicWord: DEFAULT_PUBLIC_WORD, reserved: keptPublicNames(DEFAULT_PUBLIC_WORD, OWN) };
const POPLIN = { publicWord: "poplin" as PublicWord, reserved: keptPublicNames("poplin" as PublicWord, OWN) };

function publicNameOf(raw: string): PublicName {
  const parsed = parsePublicName(raw, OWN);
  if (!parsed.ok) throw new Error(`fixture ${JSON.stringify(raw)} is not a public name`);

  return parsed.value;
}

function labelOf(raw: string): SiteLabel {
  return siteLabel(publicNameOf(raw), mintSiteId());
}

describe("the length of an address", () => {
  // Drift: DNS carries 63 characters in a label; 40 + 2 + 12 + 2 + 7 = 63 leaves no room, so a longer name, id, letter part, or marker gives the longest names addresses nothing resolves.
  test("the longest name, `--`, an id, a dash and a letter, and `-poplin` fill one DNS label exactly, and the longest public name under the longest public word fits", () => {
    const lengths = { site: siteHostLabel(labelOf(LONGEST_NAME), "p").length, publicName: publicHostLabel(publicNameOf(LONGEST_NAME), LONGEST_WORD).length };

    expect({ longerNameRefused: parseSiteName(`${LONGEST_NAME}a`).ok, longerWordRefused: parsePublicWord(`${LONGEST_WORD}s`), lengths }).toEqual({
      longerNameRefused: false,
      longerWordRefused: undefined,
      lengths: { site: 40 + 2 + 12 + 2 + 7, publicName: 40 + 1 + 9 },
    });
    expect(lengths.site).toBe(DNS_LABEL_LIMIT);
  });

  // Drift: `--` third and fourth is the form of an encoded name, which URL parsers refuse in any other label; the shortest names are the ones that could make it.
  test.each(["abc", "a-b", "abcd", "ab-c"])("no address of the name %j has `--` as its third and fourth characters", (raw) => {
    const labels = [siteHostLabel(labelOf(raw), "p"), siteHostLabel(labelOf(raw), "u"), publicHostLabel(publicNameOf(raw), DEFAULT_PUBLIC_WORD)];

    expect(labels.filter((label) => label.startsWith("--", 2))).toEqual([]);
  });
});

describe("readHostLabel", () => {
  // Drift: links are built with `siteHostLabel` and `publicHostLabel` and read with this one function; if they disagree, every published link is dead.
  test("a site address under each letter and a public address read back to the same site", () => {
    const name = publicNameOf("q3-report");
    const id = mintSiteId();
    const labels = [siteHostLabel(siteLabel(name, id), "p"), siteHostLabel(siteLabel(name, id), "u"), siteHostLabel(id, "p"), publicHostLabel(name, DEFAULT_PUBLIC_WORD)];

    expect<unknown>({ labels, readBack: labels.map((label) => readHostLabel(label, PAGE)) }).toEqual({
      labels: [`q3-report--${id}-p-poplin`, `q3-report--${id}-u-poplin`, `${id}-p-poplin`, "q3-report-page"],
      readBack: [
        { kind: "site", name, id, letter: "p" },
        { kind: "site", name, id, letter: "u" },
        { kind: "site", id, letter: "p" },
        { kind: "public-name", name },
      ],
    });
  });

  // Drift: this is the first thing every request meets; a label read as a site when it is not would spend a lookup on any hostname the zone receives.
  test.each([
    [`report--${ID}-p-poplin`, { kind: "site", name: "report", id: ID, letter: "p" }],
    [`report--${ID}-u-poplin`, { kind: "site", name: "report", id: ID, letter: "u" }],
    [`report--${ID}-poplin`, { kind: "site", name: "report", id: ID }],
    [`${ID}-poplin`, { kind: "site", id: ID }],
    [`${ID}-u-poplin`, { kind: "site", id: ID, letter: "u" }],
    [`gallery--${ID}-u-poplin`, { kind: "site", name: "gallery", id: ID, letter: "u" }],
    [`my-u--${ID}-poplin`, { kind: "site", name: "my-u", id: ID }],
    ["docs-page", { kind: "public-name", name: "docs" }],
    ["my-page-page", { kind: "public-name", name: "my-page" }],
    ["my-poplin-page", { kind: "public-name", name: "my-poplin" }],
    ["docs-p-page", { kind: "public-name", name: "docs-p" }],
    [`${ID}-page`, { kind: "public-name", name: ID }],
    ["admin-page", { kind: "public-name", name: "admin" }],
    ["docs", { kind: "not-ours" }],
    [`report--${ID}`, { kind: "not-ours" }],
    [`report--${ID}-u`, { kind: "not-ours" }],
    ["docs-pages", { kind: "not-ours" }],
    ["docspage", { kind: "not-ours" }],
    ["docs-page-2", { kind: "not-ours" }],
    ["", { kind: "not-ours" }],
    ["docs-poplin", { kind: "not-found" }],
    ["docs-u-poplin", { kind: "not-found" }],
    ["-poplin", { kind: "not-found" }],
    ["-page", { kind: "not-found" }],
    ["ab-page", { kind: "not-found" }],
    ["gallery-page", { kind: "not-found" }],
    ["Docs-page", { kind: "not-found" }],
    ["docs--page", { kind: "not-found" }],
    [`report--${ID}-page`, { kind: "not-found" }],
    [`report--${ID}-u-page`, { kind: "not-found" }],
    [`report--${ID}z-u-poplin`, { kind: "not-found" }],
    [`report---${ID}-u-poplin`, { kind: "not-found" }],
    [`report--${ID}-x-poplin`, { kind: "not-found" }],
    [`report--${ID}-up-poplin`, { kind: "not-found" }],
    [`report--${ID}--u-poplin`, { kind: "not-found" }],
    [`re--${ID}-u-poplin`, { kind: "not-found" }],
    ["report--poplin", { kind: "not-found" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("under the public word `page`, %j reads as %j", (label, outcome) => {
    expect<unknown>(readHostLabel(label, PAGE)).toEqual(outcome);
  });

  // Drift: under the public word `poplin` both forms share an ending; a public name read where a label address stands would be gated by the private login or would shadow an id.
  test.each([
    ["docs-poplin", { kind: "public-name", name: "docs" }],
    [`${ID}-poplin`, { kind: "site", id: ID }],
    [`${ID}-p-poplin`, { kind: "site", id: ID, letter: "p" }],
    [`report--${ID}-poplin`, { kind: "site", name: "report", id: ID }],
    ["docs-p-poplin", { kind: "not-found" }],
    ["docs-u-poplin", { kind: "not-found" }],
    ["gallery-poplin", { kind: "not-found" }],
    ["docs-page", { kind: "not-ours" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("under the public word `poplin`, %j reads as %j", (label, outcome) => {
    expect<unknown>(readHostLabel(label, POPLIN)).toEqual(outcome);
  });
});
