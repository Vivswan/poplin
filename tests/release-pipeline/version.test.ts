/** The version strings the pipeline mints and reads: a wrong one publishes under a name that sorts in the wrong place, or names no commit. */

import { describe, expect, test } from "bun:test";
import { mintedVersion } from "../../.github/scripts/release-pipeline/minted-version.js";
import { atFloor } from "../../.github/scripts/release-pipeline/npm-floor.js";
import { prereleaseVersion } from "../../.github/scripts/release-pipeline/prerelease-version.js";
import type { MainPosition } from "../../.github/scripts/release-pipeline/records.js";
import { releaseVersion } from "../../.github/scripts/release-pipeline/release-version.js";

/** The version grammar as semver.org states it: what npm holds a version to before it normalizes one. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const SHA = "b8df084c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a";

/** A sha whose first seven characters are digits with a leading zero: bare, npm would rewrite it to 123456. */
const DIGIT_SHA = "0123456789abcdef0123456789abcdef01234567";

const at = (count: number, date = "20260913"): MainPosition => ({ count, date });

describe("prereleaseVersion", () => {
  test.each<[string, MainPosition, string, string]>([
    ["2.0.0", at(446), SHA, "2.0.1-main.446.20260913.gb8df084"],
    ["2.9.9", at(7, "20250101"), SHA, "2.9.10-main.7.20250101.gb8df084"],
    ["0.0.0", at(1), SHA, "0.0.1-main.1.20260913.gb8df084"],
    ["2.0.0", at(446), DIGIT_SHA, "2.0.1-main.446.20260913.g0123456"],
  ])("manifest %s at %j of %s mints %s, a version npm takes as written", (manifest, position, source, expected) => {
    const version = prereleaseVersion(manifest, position, source);

    expect(version).toBe(expected);
    expect(version).toMatch(SEMVER);
  });

  test("npm's order puts a pre-release above its release, below the next one, and along main by count", () => {
    const ordered = [
      "2.0.0",
      prereleaseVersion("2.0.0", at(9, "20260913"), SHA),
      prereleaseVersion("2.0.0", at(10, "20260101"), DIGIT_SHA),
      "2.0.1",
    ];

    expect([...ordered].reverse().sort(Bun.semver.order)).toEqual(ordered);
  });
});

describe("releaseVersion", () => {
  test.each<[string, string, string, string]>([
    [
      "a tag ahead of package.json",
      "v2.2.0",
      "2.1.0",
      "package.json at the release source is version 2.1.0, but the release tag is v2.2.0; refusing to publish a version this source did not release.",
    ],
    ["a tag with a component prefix", "poplin-v2.1.0", "2.1.0", 'the release tag "poplin-v2.1.0" is not vX.Y.Z'],
    ["a tag without the v", "2.1.0", "2.1.0", 'the release tag "2.1.0" is not vX.Y.Z'],
    ["a pre-release tag, even one package.json agrees with", "v2.1.0-rc.1", "2.1.0-rc.1", 'the release tag "v2.1.0-rc.1" is not vX.Y.Z'],
    ["a tag with a leading zero", "v2.01.0", "2.01.0", 'the release tag "v2.01.0" is not vX.Y.Z'],
  ])("%s is refused, so latest never takes a version the release did not name", (_name, tag, packageVersion, error) => {
    expect(() => releaseVersion(tag, packageVersion)).toThrow(error);
  });
});

describe("mintedVersion", () => {
  test.each<[string, string]>([
    [SHA, "b8df084"],
    [DIGIT_SHA, "0123456"],
  ])("a pre-release minted for %s reads back with the short sha %s: the guards place a published version by it", (source, sha7) => {
    expect(mintedVersion(prereleaseVersion("2.1.0", at(446), source))).toEqual({ release: "2.1.1", sha7 });
  });
});

describe("atFloor", () => {
  test.each<[string, boolean]>([
    ["11.5.1", true],
    ["11.10.0", true],
    ["12.0.0", true],
    ["11.5.0", false],
    ["10.9.2", false],
    ["11.5.1-pre.0", false],
    ["not-a-version", false],
  ])("npm %s at the 11.5.1 floor: %p (numeric order, a prerelease of the floor below it)", (version, expected) => {
    expect(atFloor(version)).toBe(expected);
  });
});
