/** Whether a release may be published, judged from the registry's record. */

import { mintedVersion } from "./minted-version.js";
import type { Packument, PublishVerdict } from "./records.js";

/**
 * The guard before a plain `npm publish`, which moves `latest` and leaves `next` alone.
 *
 * Until the first release, `latest` names whatever the first publish was, a pre-release included: the registry always
 * carries that tag. A release must take it over, so only a newer release holds one back.
 *
 * @param version - the release version this run would publish, X.Y.Z
 * @param packument - the registry's record, or null for a package it has never seen
 * @throws {Error} `latest` names a version this pipeline never minted, which it will not order
 */
export function stablePublishVerdict(version: string, packument: Packument | null): PublishVerdict {
  if (packument === null) {
    return { publish: true, version };
  }

  if (Object.hasOwn(packument.versions, version)) {
    return { publish: false, version, reason: `${version} is already on the registry` };
  }

  const latest = packument["dist-tags"].latest;

  if (latest === undefined) {
    return { publish: true, version };
  }

  const held = mintedVersion(latest);

  if (held === null) {
    throw new Error(
      `the registry's latest is ${JSON.stringify(latest)}, not a version this pipeline mints (X.Y.Z or X.Y.Z-main.<count>.<date>.g<sha7>); refusing to order it.`,
    );
  }

  if (held.sha7 === null && Bun.semver.order(held.release, version) > 0) {
    return {
      publish: false,
      version,
      reason: `the registry's latest is ${latest}, newer than ${version}, so this rerun of an older release publishes nothing (npm publish would move latest back)`,
    };
  }

  return { publish: true, version };
}
