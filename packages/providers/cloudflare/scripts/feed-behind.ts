// Says whether the project's website must be built again for the release of this tree's version: `bun packages/providers/cloudflare/scripts/feed-behind.ts`.
//
//   the website's file of releases names the version                        -> named: nothing to do
//   it does not, and the release's page holds no manifest of built files    -> not_out: a draft, or a version no release was made of
//   it does not, and the release's page holds the manifest                  -> behind: the website was built before the release was out
//   the website's file cannot be read, or GitHub gives another answer       -> thrown: nothing is built on a guess
//
// A build of this tree names only the releases this tree's changelog holds. So it is started only where the website was read, and lacks this tree's version.

import { setOutput } from "@actions/core";

import { version as treeVersion } from "../../../cli/package.json";
import { bundleAddress, MANIFEST_FILE, projectReleases } from "../src/shared/release/publish/release-source";

/** How long GitHub may take to answer for the manifest, in milliseconds. */
const ANSWER_WITHIN = 60_000;

/** What the reading reaches the world through: the platform's own `fetch`, or a stand-in. */
interface Reach {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

/** Where the website stands on a version, by the table at the top of this file. */
type Feed = "named" | "not_out" | "behind";

/**
 * Read whether the website's file of releases lacks a release that is out.
 *
 * @param version - the version the tree's files say
 * @throws {Error} the website gave no file of releases that can be read, or GitHub answered for the manifest with neither the file nor that there is none
 */
export async function feedOf(version: string, reach: Reach): Promise<Feed> {
  const pins = await projectReleases(reach).pins();
  if (pins === undefined) throw new Error("the website gave no file of releases that can be read");

  if (pins[version] !== undefined) return "named";

  const manifest = await reach.fetch(bundleAddress(version, MANIFEST_FILE), { signal: AbortSignal.timeout(ANSWER_WITHIN) });
  await manifest.body?.cancel();

  if (manifest.status === 404) return "not_out";

  if (manifest.status !== 200) throw new Error(`release ${version}: GitHub answered ${manifest.status} for its manifest of built files`);

  return "behind";
}

if (import.meta.main) {
  const feed = await feedOf(treeVersion, { fetch });

  console.log(`release ${treeVersion}: ${feed}`);
  setOutput("behind", feed === "behind");
}
