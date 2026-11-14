/** The version a main commit's build publishes under the `next` dist-tag. */

import { FULL_SHA } from "./constants.js";
import type { MainPosition } from "./records.js";

/**
 * `X.Y.(Z+1)-main.<count>.<date>.g<sha7>`: above the last release, below the next one whatever its bump, and along main.
 *
 * npm compares the count first, and it grows by one with each merge; the date is for the reader. The sha carries a `g`
 * because npm reads an all-digit identifier as a number and drops its leading zero, so a bare 0123456 would name no commit.
 *
 * @param manifestVersion - the last released version, X.Y.Z
 * @param sourceSha - the full sha of the commit whose build is published
 * @throws {Error} the manifest version is not X.Y.Z, the count is not a positive integer, or the sha is not a full one
 */
export function prereleaseVersion(manifestVersion: string, position: MainPosition, sourceSha: string): string {
  const version = manifestVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!version) {
    throw new Error(
      `the manifest version ${JSON.stringify(manifestVersion)} is not X.Y.Z; refusing to derive a pre-release version from it.`,
    );
  }

  // The first commit counts 1, so a count of 0 names no commit.
  if (!Number.isInteger(position.count) || position.count < 1) {
    throw new Error(
      `the commit count ${JSON.stringify(position.count)} is not a positive integer; refusing to mint a pre-release version from it.`,
    );
  }

  if (!FULL_SHA.test(sourceSha)) {
    throw new Error(
      `the source ${JSON.stringify(sourceSha)} is not a full commit sha; refusing to mint a pre-release version from it.`,
    );
  }

  const [, major, minor, patch] = version;

  return `${major}.${minor}.${Number(patch) + 1}-main.${position.count}.${position.date}.g${sourceSha.slice(0, 7)}`;
}
