// Where a hosted build takes a release of poplin from, with no token: which releases there are and the digest of each from the project's website, the files from GitHub.
//
// The website is built from the main branch alone, so only what that branch released is named there. The files are an asset of the release's page, and are trusted for nothing: the deploy takes them only when their digest is the published one.

import { homepage } from "../../../../../../cli/package.json";
import { textUpTo } from "@poplin/core/src/api/text-up-to";
import { publishedPins, type ReleasePins } from "@poplin/core/src/records/release";

/** The repository the releases are made in. */
const REPOSITORY = "https://github.com/Vivswan/poplin";

/** The manifest of a release's built files, as the name of its asset ends. */
export const MANIFEST_FILE = "worker.json";

/** The file of the project's website that names every release an install may take, with the digest of its files. */
const PINS_ADDRESS = new URL("releases.json", homepage).href;

/** The most bytes of that file that are read. */
const MOST_PINS_BYTES = 1_048_576;

/** How long the website and GitHub may each take to answer, in milliseconds. */
const ANSWER_WITHIN = 60_000;

/** A place releases are taken from. */
export interface ReleaseSource {
  /** Reads which releases are published, each with the digest of its files; `undefined` for no answer that can be read. */
  readonly pins: () => Promise<ReleasePins | undefined>;

  /** Fetches the files of one release as the bytes of its archive; `undefined` when they cannot be fetched. */
  readonly fetch: (version: string) => Promise<Uint8Array<ArrayBuffer> | undefined>;
}

/** What the source reaches the world through: the platform's own `fetch`, or a stand-in. */
interface Reach {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

async function readPins(reach: Reach): Promise<ReleasePins | undefined> {
  try {
    const answer = await reach.fetch(PINS_ADDRESS, { signal: AbortSignal.timeout(ANSWER_WITHIN) });
    if (answer.status !== 200 || answer.body === null) {
      await answer.body?.cancel();

      return undefined;
    }

    const text = await textUpTo(answer.body, MOST_PINS_BYTES);

    return text === undefined ? undefined : publishedPins(text);
  } catch {
    return undefined;
  }
}

async function fetchSource(reach: Reach, version: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const answer = await reach.fetch(sourceAddress(version), { signal: AbortSignal.timeout(ANSWER_WITHIN) });
    if (answer.status !== 200) {
      await answer.body?.cancel();

      return undefined;
    }

    return new Uint8Array(await answer.arrayBuffer());
  } catch {
    return undefined;
  }
}

/**
 * The address of a release's source files: the archive the release workflow packs from the release's commit and adds to its page.
 *
 * @param version - a version as it is written, such as `0.2.0`
 */
export function sourceAddress(version: string): string {
  return `${REPOSITORY}/releases/download/v${version}/poplin-${version}.tar.gz`;
}

/**
 * The name of one asset of a release's built Worker on the release's page: the manifest, or a file the manifest names.
 *
 * @param file - `MANIFEST_FILE`, or a built file as the manifest names it, such as `worker.js`
 * @returns such as `poplin-0.2.0-worker.js`
 */
export function bundleAsset(version: string, file: string): string {
  return `poplin-${version}-${file}`;
}

/**
 * The address of one asset of a release's built Worker: the release workflow builds them from the release's commit and adds them to its page.
 *
 * @param file - as `bundleAsset` takes it
 */
export function bundleAddress(version: string, file: string): string {
  return `${REPOSITORY}/releases/download/v${version}/${bundleAsset(version, file)}`;
}

/**
 * The releases of poplin, read with no token: the published digests from the project's website, the files from GitHub.
 *
 * @returns a source that checks nothing itself: what it fetched is for `checkedRelease` to take or refuse
 */
export function projectReleases(reach: Reach): ReleaseSource {
  return {
    pins: () => readPins(reach),
    fetch: (version) => fetchSource(reach, version),
  };
}
