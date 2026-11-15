// Where a hosted build takes a release of poplin from: GitHub, with no token.
//
// The newest release is read from the address GitHub sends `releases/latest` to. That page counts published releases alone; a tag exists before its release is published.

/** The repository the releases are made in. */
const REPOSITORY = "https://github.com/Vivswan/poplin";

/** The address GitHub sends on from to the newest published release. */
const LATEST_PAGE = `${REPOSITORY}/releases/latest`;

/** Where that address leads while the repository has no published release. */
const NO_RELEASE_PAGE = `${REPOSITORY}/releases`;

/** The page of one release, with its version as the first group. */
const RELEASE_PAGE = /^https:\/\/github\.com\/Vivswan\/poplin\/releases\/tag\/v(\d+\.\d+\.\d+)$/;

/** The status GitHub sends that address on with. Any other answer says nothing about the releases. */
const SENT_ON = 302;

/** How long GitHub may take to answer, in milliseconds. */
const ANSWER_WITHIN = 30_000;

/** Runs one command to its end, its output going where the build's goes. Answers its exit code. */
export type RunCommand = (command: readonly string[], options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }) => Promise<number>;

/** The newest published release: its version, `none` only when the source said outright that no release is published, `unknown` for every other answer. */
export type Latest = { readonly kind: "release"; readonly version: string } | { readonly kind: "none" } | { readonly kind: "unknown" };

/** A place releases are taken from. */
export interface ReleaseSource {
  /** Finds the newest published release. */
  readonly latest: () => Promise<Latest>;

  /** Puts the files of one release into a folder that does not exist yet. Answers whether it did. */
  readonly fetchInto: (version: string, folder: string) => Promise<boolean>;
}

/** What the GitHub source reaches the world through. */
interface Reach {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly run: RunCommand;
  readonly env: Readonly<Record<string, string | undefined>>;
}

async function latestRelease(reach: Reach): Promise<Latest> {
  let answer: Response;
  try {
    answer = await reach.fetch(LATEST_PAGE, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(ANSWER_WITHIN) });
  } catch {
    return { kind: "unknown" };
  }

  if (answer.status !== SENT_ON) return { kind: "unknown" };

  const target = answer.headers.get("location");
  if (target === NO_RELEASE_PAGE) return { kind: "none" };

  const version = RELEASE_PAGE.exec(target ?? "")?.[1];
  if (version === undefined) return { kind: "unknown" };

  return { kind: "release", version };
}

/**
 * The releases of poplin on GitHub, read with no token and outside the REST API's hourly allowance.
 *
 * @returns a source whose `fetchInto` clones the release's tag with git, one commit deep
 */
export function githubReleases(reach: Reach): ReleaseSource {
  return {
    latest: () => latestRelease(reach),

    fetchInto: async (version, folder) => {
      const clone = ["git", "-c", "advice.detachedHead=false", "clone", "--depth", "1", "--branch", `v${version}`, REPOSITORY, folder];

      return (await reach.run(clone, { cwd: process.cwd(), env: reach.env })) === 0;
    },
  };
}
