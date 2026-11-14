/** The published pre-releases, placed against one source commit by ancestry. */

import { mintedVersion } from "./minted-version.js";
import type { Ancestry, Packument } from "./records.js";

/** A published pre-release whose source is a strict descendant of the run's: newer on main, whatever its numbers say. */
interface Descendant {
  /** The published pre-release version. */
  version: string;

  /** The full sha the version's short sha resolved to. */
  sha: string;
}

/** The published pre-releases as one source sees them. */
export interface PublishedSources {
  /** The pre-release furthest along main among those whose source descends from the run's, or null when there is none. */
  newest: Descendant | null;

  /** One line for each pre-release whose source could not be placed. */
  notices: string[];
}

type Placement = "own" | "ancestor" | "descendant" | "unrelated";

type Placed = { sha: string; placement: Placement } | { sha: null; placement: "unresolved" };

function placeSource(ancestry: Ancestry, sourceSha: string, sha7: string): Placed {
  const sha = ancestry.resolve(sha7);

  if (sha === null) {
    return { sha, placement: "unresolved" };
  }

  if (sha === sourceSha) {
    return { sha, placement: "own" };
  }

  if (ancestry.isAncestor(sourceSha, sha)) {
    return { sha, placement: "descendant" };
  }

  if (ancestry.isAncestor(sha, sourceSha)) {
    return { sha, placement: "ancestor" };
  }

  return { sha, placement: "unrelated" };
}

/**
 * Places every pre-release on the record, and the version `next` names whether or not the record lists it.
 *
 * @param sourceSha - the full sha of the commit this run publishes
 */
export function placePublished(ancestry: Ancestry, sourceSha: string, packument: Packument): PublishedSources {
  const placed: PublishedSources = { newest: null, notices: [] };
  const versions = new Set(Object.keys(packument.versions));
  const nextVersion = packument["dist-tags"].next;
  if (nextVersion !== undefined) versions.add(nextVersion);

  for (const version of versions) {
    const sha7 = mintedVersion(version)?.sha7 ?? null;
    if (sha7 === null) continue;

    const source = placeSource(ancestry, sourceSha, sha7);

    if (source.sha === null) {
      placed.notices.push(`${version} names ${sha7}, which is no commit in this checkout; ignored`);
      continue;
    }

    if (source.placement === "unrelated") {
      placed.notices.push(
        `${version} names ${sha7}, which is neither an ancestor nor a descendant of ${sourceSha.slice(0, 7)} on main; ignored`,
      );
      continue;
    }

    if (source.placement !== "descendant") continue;

    if (placed.newest === null || ancestry.isAncestor(placed.newest.sha, source.sha)) placed.newest = { version, sha: source.sha };
  }

  return placed;
}
