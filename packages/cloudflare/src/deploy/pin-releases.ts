// Which releases the project's website names as ones an install may take, each with the SHA-256 digest of its source archive. It runs before the website's build, in the run of the main branch that deploys the site.
//
//   the archive is on the release's page, and its attestation holds   named, with the digest of the fetched bytes
//   no archive on the page: a draft, or a release not made yet        not named
//   an archive whose attestation GitHub's command line does not pass  thrown: the site is not built, and the one deployed before stays
//   any other answer of GitHub's, or none                             thrown, the same
//
// The command line fails alike for an archive nobody attested and for a service that is down, so neither drops a release from the file: a file that lost one would send a build back to its copy's own files.
//
// The attestation that holds is one made by the release workflow, in a run of the main branch of this repository: a file put on a release's page any other way is never named.

import { join } from "node:path";

import { type ReleasePins, releaseDigest } from "@poplin/core/src/records/release";
import { isPlainVersion } from "@poplin/core/src/records/update";

import { sourceAddress } from "./release-source";

/** The repository the releases are made in, as GitHub's command line names it. */
const REPOSITORY = "Vivswan/poplin";

/** The workflow that packs a release's archive and attests it. */
const SIGNER = `${REPOSITORY}/.github/workflows/update-release.yml`;

/** The one branch a run that attests an archive is of. */
const SIGNED_ON = "refs/heads/main";

/** How long GitHub may take to answer with an archive, in milliseconds. */
const ANSWER_WITHIN = 60_000;

/** What the pinning reaches the world through. */
interface Pinning {
  /** The platform's own `fetch`, or a stand-in. */
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;

  /** Runs GitHub's command line to its end, and answers its exit code. */
  readonly run: (command: readonly string[]) => Promise<number>;

  /** An empty folder the fetched archives are written into. */
  readonly scratch: string;

  /** Prints one line. */
  readonly say: (line: string) => void;
}

/** Fetch one release's archive. `undefined` is a page with no archive. */
async function archiveOf(version: string, pinning: Pinning): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const answer = await pinning.fetch(sourceAddress(version), { signal: AbortSignal.timeout(ANSWER_WITHIN) });

  if (answer.status === 404) {
    await answer.body?.cancel();

    return undefined;
  }

  if (answer.status !== 200) throw new Error(`release ${version}: GitHub answered ${answer.status} for its source archive`);

  return new Uint8Array(await answer.arrayBuffer());
}

/** Whether an archive on disk carries an attestation of the release workflow, made in a run of main. */
async function attested(file: string, pinning: Pinning): Promise<boolean> {
  const verify = ["gh", "attestation", "verify", file, "--repo", REPOSITORY, "--signer-workflow", SIGNER, "--source-ref", SIGNED_ON, "--deny-self-hosted-runners"];

  return (await pinning.run(verify)) === 0;
}

/**
 * Make the website's file of releases: every given version whose archive is published and attested, with the digest of that archive.
 *
 * @param versions - the versions the main branch's changelog names; one that is no plain version is never named
 * @returns the releases to publish, by the table at the top of this file
 * @throws {Error} GitHub answered neither with an archive nor that there is none, or an archive's attestation did not pass
 */
export async function pinReleases(versions: readonly string[], pinning: Pinning): Promise<ReleasePins> {
  const pins: Record<string, { source: string }> = {};

  for (const version of versions.filter(isPlainVersion)) {
    const bytes = await archiveOf(version, pinning);

    if (bytes === undefined) {
      pinning.say(`release ${version}: no source archive is published, so it is not named`);
      continue;
    }

    const file = join(pinning.scratch, `poplin-${version}.tar.gz`);
    await Bun.write(file, bytes);

    if (!(await attested(file, pinning))) throw new Error(`release ${version}: its source archive did not pass as attested by the release workflow in a run of main`);

    pins[version] = { source: await releaseDigest(bytes) };
    pinning.say(`release ${version}: named, with the digest ${pins[version].source}`);
  }

  return pins;
}
