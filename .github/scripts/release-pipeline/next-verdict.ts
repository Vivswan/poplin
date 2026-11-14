/** Whether a main commit's pre-release may be published, judged from the registry's record. */

import { placePublished } from "./published-sources.js";
import type { Ancestry, NextVerdict, Packument } from "./records.js";

/**
 * The guard before `npm publish --tag next`, which moves `next` to whatever it publishes.
 *
 * A rerun of a run that already published, or a stale retry once a descendant's pre-release is on the registry,
 * publishes nothing, whatever order the runs finished in. A source the checkout cannot place is set aside with a notice.
 *
 * @param sourceSha - the full sha of the commit this run publishes
 * @param version - the pre-release version this run would publish
 * @param packument - the registry's record, or null for a package it has never seen
 */
export function nextPublishVerdict(ancestry: Ancestry, sourceSha: string, version: string, packument: Packument | null): NextVerdict {
  if (packument === null) {
    return { publish: true, version, notices: [] };
  }

  // A dist-tag names a version the registry holds, so next naming this one is the same rerun as the record listing it.
  if (Object.hasOwn(packument.versions, version) || packument["dist-tags"].next === version) {
    return { publish: false, version, reason: `${version} is already on the registry`, notices: [] };
  }

  const { newest, notices } = placePublished(ancestry, sourceSha, packument);

  if (newest !== null) {
    return {
      publish: false,
      version,
      reason: `the registry already holds ${newest.version}, whose source ${newest.sha.slice(0, 7)} is a descendant of ${sourceSha.slice(0, 7)} on main, so this stale run publishes nothing (npm publish --tag next would move next back)`,
      notices,
    };
  }

  return { publish: true, version, notices };
}
