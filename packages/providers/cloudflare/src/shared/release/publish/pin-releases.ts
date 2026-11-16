// Which releases the project's website names as ones an install may take, each with the SHA-256 digest of the manifest of its built Worker, and its schema. It runs before the website's build.
//
//   the manifest and every built file are on the release's page, and each one's attestation holds                 named
//   no manifest on the page of the newest version given: a draft, or a release not made yet                       not named
//   no manifest on the page of an older version: a release that was out, and lost its manifest                    thrown: the site is not built, and the one deployed before stays
//   a manifest that names a file the page lacks                                                                   thrown, the same
//   a file whose attestation GitHub's command line does not pass                                                  thrown, the same
//   a manifest that cannot be read, is of another version, or states another digest or size than a built file     thrown, the same
//   any other answer of GitHub's, or none                                                                         thrown, the same
// The command line fails alike for a file nobody attested and for a service that is down, so neither drops a release from the file: an install on that release would no longer find it there.
// The attestation that holds is one made by the release workflow, in a run of the main branch of this repository: a file put on a release's page any other way is never named.

import { join } from "node:path";

import { type ReleasePins, releaseDigest } from "@poplin/core/src/records/release";
import { bundleFileProblem, readBundle } from "@poplin/core/src/records/release-bundle";
import { isPlainVersion } from "@poplin/core/src/records/update";

import { bundleAddress, bundleAsset, MANIFEST_FILE } from "./release-source";

/** The repository the releases are made in, as GitHub's command line names it. */
const REPOSITORY = "Vivswan/poplin";

/** The workflow that takes a release's built files and attests them all. */
const SIGNER = `${REPOSITORY}/.github/workflows/update-release.yml`;

/** The one branch a run that attests a release's files is of. */
const SIGNED_ON = "refs/heads/main";

/** How long GitHub may take to answer with a file, in milliseconds. */
const ANSWER_WITHIN = 60_000;

/** What the pinning reaches the world through. */
interface Pinning {
  /** The platform's own `fetch`, or a stand-in. */
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;

  /** Runs GitHub's command line to its end, and answers its exit code. */
  readonly run: (command: readonly string[]) => Promise<number>;

  /** An empty folder the fetched files are written into. */
  readonly scratch: string;

  /** Prints one line. */
  readonly say: (line: string) => void;
}

/** One file of a release's page. */
interface Asset {
  /** The version of the release. */
  readonly version: string;

  /** The file's name on the page. */
  readonly name: string;

  /** Where it is fetched. */
  readonly address: string;

  /** What a sentence calls it, such as `manifest of built files`. */
  readonly what: string;
}

/** Fetch one file of a release's page. `undefined` is a page without it. */
async function fetched(asset: Asset, pinning: Pinning): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const answer = await pinning.fetch(asset.address, { signal: AbortSignal.timeout(ANSWER_WITHIN) });

  if (answer.status === 404) {
    await answer.body?.cancel();

    return undefined;
  }

  if (answer.status !== 200) throw new Error(`release ${asset.version}: GitHub answered ${answer.status} for its ${asset.what}`);

  return new Uint8Array(await answer.arrayBuffer());
}

/** Check that a fetched file carries an attestation of the release workflow, made in a run of main. */
async function attest(asset: Asset, bytes: Uint8Array<ArrayBuffer>, pinning: Pinning): Promise<void> {
  const file = join(pinning.scratch, asset.name);
  await Bun.write(file, bytes);

  const verify = ["gh", "attestation", "verify", file, "--repo", REPOSITORY, "--signer-workflow", SIGNER, "--source-ref", SIGNED_ON, "--deny-self-hosted-runners"];
  if ((await pinning.run(verify)) !== 0) throw new Error(`release ${asset.version}: its ${asset.what} did not pass as attested by the release workflow in a run of main`);
}

/** One file of the built Worker as the release's page holds it: the manifest, or a file the manifest names. */
function assetOf(version: string, file: string): Asset {
  const what = file === MANIFEST_FILE ? "manifest of built files" : `built file ${file}`;

  return { version, name: bundleAsset(version, file), address: bundleAddress(version, file), what };
}

/** Fetch one file the manifest names, which a page with a manifest always holds, and check its attestation. */
async function built(version: string, file: string, pinning: Pinning): Promise<Uint8Array<ArrayBuffer>> {
  const asset = assetOf(version, file);

  const bytes = await fetched(asset, pinning);
  if (bytes === undefined) throw new Error(`release ${version}: its page holds a manifest of built files and no ${asset.what}`);

  await attest(asset, bytes, pinning);

  return bytes;
}

/** Check the built Worker of a release by its fetched manifest. Answers the digest of the manifest and the release's schema. */
async function bundleOf(version: string, manifest: Uint8Array<ArrayBuffer>, pinning: Pinning): Promise<ReleasePins[string]> {
  await attest(assetOf(version, MANIFEST_FILE), manifest, pinning);

  const read = readBundle(new TextDecoder().decode(manifest));
  if (!read.ok) throw new Error(`release ${version}: its manifest of built files ${read.problem}`);

  if (read.bundle.version !== version) throw new Error(`release ${version}: its manifest of built files says it is of ${read.bundle.version}`);

  for (const file of Object.keys(read.bundle.files)) {
    const problem = await bundleFileProblem(read.bundle, file, await built(version, file, pinning));

    if (problem !== undefined) throw new Error(`release ${version}: its built file ${file} ${problem}`);
  }

  return { bundle: await releaseDigest(manifest), schema: read.bundle.schema };
}

/**
 * Make the website's file of releases: every given version whose built Worker is published and attested.
 *
 * @param versions - the versions the main branch's changelog names, the newest first; one that is no plain version is never named
 * @returns the releases to publish, by the table at the top of this file
 * @throws {Error} GitHub answered neither with a file nor that there is none, an older version has no manifest, a file's attestation did not pass, or the built files are not the ones their manifest states
 */
export async function pinReleases(versions: readonly string[], pinning: Pinning): Promise<ReleasePins> {
  const pins: Record<string, ReleasePins[string]> = {};
  const plain = versions.filter(isPlainVersion);

  for (const version of plain) {
    const manifest = await fetched(assetOf(version, MANIFEST_FILE), pinning);

    // Only the newest version may be a release that is not out yet. An older one without its manifest would drop a release installs take from the file.
    if (manifest === undefined && version !== plain[0]) throw new Error(`release ${version}: no manifest of built files is published, and a newer version is named`);

    if (manifest === undefined) {
      pinning.say(`release ${version}: no manifest of built files is published, so it is not named`);
      continue;
    }

    const pin = await bundleOf(version, manifest, pinning);
    pins[version] = pin;
    pinning.say(`release ${version}: named, with the digest ${pin.bundle} of its built files, and schema ${pin.schema}`);
  }

  return pins;
}
