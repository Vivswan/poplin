import { describe, expect, test } from "bun:test";

import { parseSiteName } from "../src/names/names";
import { mintSiteId } from "../src/sites/ids";
import { siteLabel, siteReference, splitLabel } from "../src/sites/labels";

const NO_OWN_NAMES: ReadonlySet<string> = new Set();
const OWN_NAMES: ReadonlySet<string> = new Set(["admin"]);
const ID = "k3f9x2ab71qz";
const LONGEST_NAME = "a".repeat(40);

describe("splitLabel", () => {
  // Drift: serving trusts this split to tell a site's own address from a public name; a loose split would look a site up under a string that is no id.
  test.each([
    [`report--${ID}`, { ok: true, value: { kind: "site", name: "report", id: ID } }],
    [`q3-report--${ID}`, { ok: true, value: { kind: "site", name: "q3-report", id: ID } }],
    [`${ID}--${ID}`, { ok: true, value: { kind: "site", name: ID, id: ID } }],
    ["report", { ok: true, value: { kind: "public-name", name: "report" } }],
    [ID, { ok: true, value: { kind: "public-name", name: ID } }],
    ["report--", { ok: false, refusal: "bad-id" }],
    ["report--short", { ok: false, refusal: "bad-id" }],
    [`report--${ID}x`, { ok: false, refusal: "bad-id" }],
    ["report--K3F9X2AB71QZ", { ok: false, refusal: "bad-id" }],
    [`report--abc--${ID}`, { ok: false, refusal: "bad-id" }],
    [`report---${ID}`, { ok: false, refusal: "bad-id" }],
    [`--${ID}`, { ok: false, refusal: "empty" }],
    [`ab--${ID}`, { ok: false, refusal: "too-short" }],
    [`Report--${ID}`, { ok: false, refusal: "bad-character" }],
    ["report-", { ok: false, refusal: "trailing-dash" }],
    ["ab", { ok: false, refusal: "too-short" }],
    ["", { ok: false, refusal: "empty" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("splits %j", (label, outcome) => {
    expect<unknown>(splitLabel(label, NO_OWN_NAMES)).toEqual(outcome);
  });

  test("drift: one of the install's own names is no public name, yet a site may be called by it, since its address always carries the id", () => {
    expect<unknown>([splitLabel("admin", OWN_NAMES), splitLabel("gallery", OWN_NAMES), splitLabel(`admin--${ID}`, OWN_NAMES), splitLabel(`gallery--${ID}`, OWN_NAMES)]).toEqual([
      { ok: false, refusal: "reserved" },
      { ok: false, refusal: "reserved" },
      { ok: true, value: { kind: "site", name: "admin", id: ID } },
      { ok: true, value: { kind: "site", name: "gallery", id: ID } },
    ]);
  });
});

describe("siteLabel", () => {
  // Drift: links are built with one function and read with another; a name with dashes, or one that itself reads as an id, must come back as it went in.
  test.each(["abc", "report", "q3-report-2", "report-k3f9x2", ID, LONGEST_NAME])("the label of %j reads back as the same name and id", (raw) => {
    const name = parseSiteName(raw);
    if (!name.ok) throw new Error(`fixture is not a site name: ${raw}`);

    const id = mintSiteId();
    const label = siteLabel(name.value, id);

    expect<unknown>([label, splitLabel(label, NO_OWN_NAMES)]).toEqual([`${raw}--${id}`, { ok: true, value: { kind: "site", name: raw, id } }]);
  });
});

describe("siteReference", () => {
  // Drift: a command acts on the site this names; twelve base36 characters read as a name first would send an id to the public-name lookup and miss the site.
  test.each([
    [`report--${ID}`, { ok: true, value: { kind: "site", name: "report", id: ID } }],
    [ID, { ok: true, value: { kind: "id", id: ID } }],
    ["summerreport", { ok: true, value: { kind: "id", id: "summerreport" } }],
    ["docs", { ok: true, value: { kind: "public-name", name: "docs" } }],
    ["summer-report", { ok: true, value: { kind: "public-name", name: "summer-report" } }],
    [`${ID}z`, { ok: true, value: { kind: "public-name", name: `${ID}z` } }],
    ["admin", { ok: false, refusal: "reserved" }],
    [`admin--${ID}`, { ok: true, value: { kind: "site", name: "admin", id: ID } }],
    [`report--${ID}z`, { ok: false, refusal: "bad-id" }],
    ["Report", { ok: false, refusal: "bad-character" }],
    ["ab", { ok: false, refusal: "too-short" }],
    ["", { ok: false, refusal: "empty" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("reads %j", (raw, outcome) => {
    expect<unknown>(siteReference(raw, OWN_NAMES)).toEqual(outcome);
  });
});
