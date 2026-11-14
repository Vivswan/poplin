/** What a pre-release publish left on the registry, once the record shows its version. */

import { placePublished } from "./published-sources.js";
import type { Ancestry, ConfirmVerdict, Packument } from "./records.js";

/** The publish a record is judged against. */
export interface PublishedNext {
  /** The package's name, for the repair command the drift names. */
  name: string;

  /** The full sha of the commit this run published. */
  sourceSha: string;

  /** The pre-release version this run published. */
  version: string;

  /** How many reads it took for the record to show the version. */
  reads: number;
}

/**
 * Settled, or behind when `next` does not name the pre-release furthest along main among the record's descendants.
 *
 * A drift is reported, never repaired: trusted publishing authenticates `npm publish` alone, not `npm dist-tag add`.
 * The next push to main publishes and moves `next` forward.
 *
 * @param packument - a record that shows the published version
 */
export function nextConfirmVerdict(ancestry: Ancestry, published: PublishedNext, packument: Packument): ConfirmVerdict {
  const { name, sourceSha, version, reads } = published;
  const { newest } = placePublished(ancestry, sourceSha, packument);
  const next = packument["dist-tags"].next;

  if (newest === null || newest.version === next) {
    return { outcome: "settled", version, reads };
  }

  return {
    outcome: "behind",
    version,
    reason:
      `the registry's next is ${next ?? "unset"} while it holds ${newest.version}, whose source ${newest.sha.slice(0, 7)} ` +
      `is a descendant of ${sourceSha.slice(0, 7)} on main; a stale run moved next back, and the next push to main ` +
      `moves it forward (npm dist-tag add ${name}@${newest.version} next repairs it by hand)`,
  };
}
