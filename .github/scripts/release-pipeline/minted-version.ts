/** A version this pipeline mints, read back from the registry. */

const MINTED = /^(\d+)\.(\d+)\.(\d+)(?:-main\.(?:(?:0|[1-9]\d*)\.)+g([0-9a-f]{7}))?$/;

/** A release, or a pre-release carrying its source's short sha. */
export interface MintedVersion {
  /** The X.Y.Z the version opens with. */
  release: string;

  /** The source commit's short sha; null for a release. */
  sha7: string | null;
}

/**
 * The parts of a version this pipeline mints, or null for one minted elsewhere.
 *
 * The identifiers between `main` and the sha are not read back: a published pre-release is placed by its source's
 * ancestry, never by comparing them.
 */
export function mintedVersion(version: string): MintedVersion | null {
  const match = version.match(MINTED);

  if (!match) {
    return null;
  }

  const [, major, minor, patch, sha7 = null] = match;

  return { release: `${major}.${minor}.${patch}`, sha7 };
}
