/** The publish decisions against a hand-written commit graph and registry records: a wrong one moves a dist-tag back, or publishes twice. */

import { describe, expect, test } from "bun:test";
import { nextConfirmVerdict } from "../../.github/scripts/release-pipeline/next-confirm-verdict.js";
import { nextPublishVerdict } from "../../.github/scripts/release-pipeline/next-verdict.js";
import type { ConfirmVerdict, NextVerdict, Packument, PublishVerdict } from "../../.github/scripts/release-pipeline/records.js";
import { stablePublishVerdict } from "../../.github/scripts/release-pipeline/stable-verdict.js";
import { graphAncestry, record } from "./fixture.js";

/** Main's first commit. */
const SEED = "a1".repeat(20);

/** Main's second commit: the one this run publishes. */
const SOURCE = "b2".repeat(20);

/** Main's third commit. */
const AFTER = "c3".repeat(20);

/** Main's fourth commit. */
const FURTHER = "d4".repeat(20);

/** A commit on a branch off the first, never merged. */
const SIDE = "e5".repeat(20);

/** Main is seed, source, after, further; side branches off seed and is never merged. */
const MAIN = graphAncestry({ [SEED]: [], [SOURCE]: [SEED], [AFTER]: [SOURCE], [FURTHER]: [AFTER], [SIDE]: [SEED] });

/** The pre-release this run mints, from the source commit. */
const OWN = "2.1.1-main.2.20260913.gb2b2b2b";

/** The pre-release of main's first commit. */
const ANCESTOR = "2.1.1-main.1.20260912.ga1a1a1a";

/** The pre-release of main's third commit. */
const DESCENDANT = "2.1.1-main.3.20260914.gc3c3c3c";

/** The pre-release of main's fourth commit. */
const FURTHEST = "2.1.1-main.4.20260915.gd4d4d4d";

/** A pre-release of the side commit, with this run's count and date. */
const UNRELATED = "2.1.1-main.2.20260913.ge5e5e5e";

/** A pre-release whose sha names no commit in the graph. */
const UNRESOLVED = "2.1.1-main.9.20260901.g0000000";

/** A descendant's pre-release whose identifiers sort below this run's: only the sha places it. */
const DESCENDANT_LOW = "2.1.1-main.0.gc3c3c3c";

/** The verdict that publishes this run's version, with the notices it prints. */
const goes = (...notices: string[]): NextVerdict => ({ publish: true, version: OWN, notices });

/** The verdict for a version the registry already holds. */
const rerun: NextVerdict = { publish: false, version: OWN, reason: `${OWN} is already on the registry`, notices: [] };

/** The verdict that stands down for a descendant's pre-release, named by version and short sha. */
const stale = (version: string, sha7: string): NextVerdict => ({
  publish: false,
  version: OWN,
  reason: `the registry already holds ${version}, whose source ${sha7} is a descendant of b2b2b2b on main, so this stale run publishes nothing (npm publish --tag next would move next back)`,
  notices: [],
});

describe("nextPublishVerdict", () => {
  test.each<[string, Packument | null, NextVerdict]>([
    ["a package the registry has never seen", null, goes()],
    ["the first pre-release after a release", record(["2.1.0"], { latest: "2.1.0" }), goes()],
    ["an ancestor's pre-release on next", record(["2.1.0", ANCESTOR], { latest: "2.1.0", next: ANCESTOR }), goes()],
    ["a rerun of a run that already published", record(["2.1.0", OWN], { latest: "2.1.0", next: OWN }), rerun],
    ["next naming this run's version while the record lacks it", record(["2.1.0"], { latest: "2.1.0", next: OWN }), rerun],
    ["next naming a release, which carries no source", record(["2.1.0"], { latest: "2.1.0", next: "2.1.0" }), goes()],
    ["a descendant's pre-release, whatever the dist-tags name", record(["2.1.0", ANCESTOR, DESCENDANT], { latest: "2.1.0", next: ANCESTOR }), stale(DESCENDANT, "c3c3c3c")],
    ["a descendant's pre-release that sorts below this run's", record([DESCENDANT_LOW], { latest: DESCENDANT_LOW, next: DESCENDANT_LOW }), stale(DESCENDANT_LOW, "c3c3c3c")],
    ["two descendants' pre-releases: the furthest along main is named", record(["2.1.0", FURTHEST, DESCENDANT], { latest: "2.1.0", next: FURTHEST }), stale(FURTHEST, "d4d4d4d")],
    ["a descendant's pre-release only next names", record(["2.1.0"], { latest: "2.1.0", next: DESCENDANT }), stale(DESCENDANT, "c3c3c3c")],
    ["a release that shipped after this commit, with no pre-release of its merge", record(["2.1.0", "2.2.0"], { latest: "2.2.0" }), goes()],
    [
      "a pre-release naming a commit this checkout lacks",
      record(["2.1.0", UNRESOLVED], { latest: "2.1.0", next: UNRESOLVED }),
      goes(`${UNRESOLVED} names 0000000, which is no commit in this checkout; ignored`),
    ],
    [
      "a pre-release naming a commit off this source's line of main",
      record(["2.1.0", UNRELATED], { latest: "2.1.0", next: UNRELATED }),
      goes(`${UNRELATED} names e5e5e5e, which is neither an ancestor nor a descendant of b2b2b2b on main; ignored`),
    ],
    ["a hand-published version this pipeline never minted", record(["2.1.0", "2.1.1-beta.1"], { latest: "2.1.0" }), goes()],
  ])("%s", (_name, packument, expected) => {
    expect(nextPublishVerdict(MAIN, SOURCE, OWN, packument)).toEqual(expected);
  });
});

describe("stablePublishVerdict", () => {
  const goesStable: PublishVerdict = { publish: true, version: "2.1.0" };

  test.each<[string, Packument | null, PublishVerdict]>([
    ["a package the registry has never seen", null, goesStable],
    ["a newer release than latest", record(["2.0.0", ANCESTOR], { latest: "2.0.0", next: ANCESTOR }), goesStable],
    ["a rerun of the release's job", record(["2.0.0", "2.1.0"], { latest: "2.1.0" }), { publish: false, version: "2.1.0", reason: "2.1.0 is already on the registry" }],
    ["latest held by a pre-release that sorts above the release: the first publish put it there", record([OWN], { latest: OWN, next: OWN }), goesStable],
    ["a record with no latest", record([OWN], { next: OWN }), goesStable],
    [
      "a rerun of an older release's job after a newer release",
      record(["2.0.0", "2.2.0"], { latest: "2.2.0" }),
      {
        publish: false,
        version: "2.1.0",
        reason: "the registry's latest is 2.2.0, newer than 2.1.0, so this rerun of an older release publishes nothing (npm publish would move latest back)",
      },
    ],
  ])("%s", (_name, packument, expected) => {
    expect(stablePublishVerdict("2.1.0", packument)).toEqual(expected);
  });

  test("a two-digit minor is ordered as a number: 2.10.0 goes over a latest of 2.9.0, which text order puts above it", () => {
    expect(stablePublishVerdict("2.10.0", record(["2.9.0"], { latest: "2.9.0" }))).toEqual({ publish: true, version: "2.10.0" });
  });

  test("a latest this pipeline never minted stops the verdict: it is not ordered by guess", () => {
    expect(() => stablePublishVerdict("2.1.0", record(["2.0.1-beta.1"], { latest: "2.0.1-beta.1" }))).toThrow(
      'the registry\'s latest is "2.0.1-beta.1", not a version this pipeline mints',
    );
  });
});

describe("nextConfirmVerdict", () => {
  const published = { name: "poplin", sourceSha: SOURCE, version: OWN, reads: 2 };
  const settled: ConfirmVerdict = { outcome: "settled", version: OWN, reads: 2 };

  test.each<[string, Packument, ConfirmVerdict]>([
    ["next on this run's version, nothing newer on the record", record(["2.1.0", ANCESTOR, OWN], { latest: "2.1.0", next: OWN }), settled],
    ["next already on a descendant's pre-release: a later run moved it forward", record(["2.1.0", OWN, DESCENDANT], { latest: "2.1.0", next: DESCENDANT }), settled],
    ["a newer release on the record, which is no pre-release of a descendant", record(["2.1.0", OWN, "2.2.0"], { latest: "2.2.0", next: OWN }), settled],
    [
      "next left on this run's version while a descendant's pre-release is on the record",
      record(["2.1.0", ANCESTOR, DESCENDANT, OWN], { latest: "2.1.0", next: OWN }),
      {
        outcome: "behind",
        version: OWN,
        reason:
          `the registry's next is ${OWN} while it holds ${DESCENDANT}, whose source c3c3c3c is a descendant of b2b2b2b on main; ` +
          `a stale run moved next back, and the next push to main moves it forward (npm dist-tag add poplin@${DESCENDANT} next repairs it by hand)`,
      },
    ],
    [
      "next on an earlier descendant's pre-release than the furthest one on the record",
      record(["2.1.0", OWN, DESCENDANT, FURTHEST], { latest: "2.1.0", next: DESCENDANT }),
      {
        outcome: "behind",
        version: OWN,
        reason:
          `the registry's next is ${DESCENDANT} while it holds ${FURTHEST}, whose source d4d4d4d is a descendant of b2b2b2b on main; ` +
          `a stale run moved next back, and the next push to main moves it forward (npm dist-tag add poplin@${FURTHEST} next repairs it by hand)`,
      },
    ],
  ])("%s", (_name, packument, expected) => {
    expect(nextConfirmVerdict(MAIN, published, packument)).toEqual(expected);
  });
});
