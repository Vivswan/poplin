// Says each night whether the project's website names the newest release: `bun packages/providers/cloudflare/scripts/live/feed-watch.ts`.
//
//   releases.json   read as an install reads it before it takes a release: its newest version is the newest tag's
//   latest.json     read as an install reads it once a day: its version is the newest tag's
//
// Each file is judged by itself, so one run names every fault. Nothing is written, and nothing but the website is asked.
//
// A release cut minutes ago is not looked for: the run that cuts a release builds the website, so by night it names that release or that run was red.

import { error } from "@actions/core";
import rsort from "semver/functions/rsort";

import { newestRelease } from "@poplin/core/src/actions/update/check-update";
import { newestPinned } from "@poplin/core/src/records/release";
import { isPlainVersion } from "@poplin/core/src/records/update";
import { projectReleases } from "../../src/shared/release/publish/release-source";

/** How long the website may take to answer for `latest.json`, in milliseconds. */
const ANSWER_WITHIN = 60_000;

/** What a tag of a release starts with, before its version. */
const TAG_START = "v";

/** What the reading reaches the world through: the platform's own `fetch`, or a stand-in. */
interface Reach {
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

/** The version of the newest release among the tags: a tag that is no `v` and a plain version is passed over. */
function newestTagged(tags: readonly string[]): string | undefined {
  const versions = tags.filter((tag) => tag.startsWith(TAG_START)).map((tag) => tag.slice(TAG_START.length));

  return rsort(versions.filter(isPlainVersion))[0];
}

/** How a file that was not read is told: by the status the website answered, or by its silence. */
function unread(file: string, status: number | undefined): string {
  if (status === undefined) return `${file}: the website gave no answer.`;

  if (status !== 200) return `${file}: the website answered ${status}.`;

  return `${file}: the website's file is not one an install can read.`;
}

/** A reach that notes the status of each answer: both readers answer `undefined` for every file they cannot read, whatever the cause. */
function noting(reach: Reach, statuses: number[]): Reach {
  return {
    fetch: async (url, init) => {
      const answer = await reach.fetch(url, init);
      statuses.push(answer.status);

      return answer;
    },
  };
}

/** What is wrong with the file of releases, read by the reader an install takes a release with. */
async function pinsFault(newest: string, reach: Reach): Promise<string | undefined> {
  const statuses: number[] = [];
  const pins = await projectReleases(noting(reach, statuses)).pins();
  if (pins === undefined) return unread("releases.json", statuses.at(-1));

  const named = newestPinned(pins);
  if (named === newest) return undefined;

  return `releases.json: its newest release is ${named ?? "none"}, and the newest tag is ${TAG_START}${newest}.`;
}

/** What is wrong with the file of the newest release, read by the reader of an install's daily question. */
async function latestFault(newest: string, reach: Reach): Promise<string | undefined> {
  const statuses: number[] = [];
  const latest = await newestRelease({ fetch: noting(reach, statuses).fetch, patienceMs: ANSWER_WITHIN });
  if (latest === undefined) return unread("latest.json", statuses.at(-1));

  if (latest?.version === newest) return undefined;

  return `latest.json: it names ${latest?.version ?? "no release"}, and the newest tag is ${TAG_START}${newest}.`;
}

/**
 * Read what is wrong with the release files of the project's website, against the tags of this repository.
 *
 * @param tags - every tag of the repository, in any order, such as `v0.2.0`
 * @returns one sentence for each fault, none for a website that names the newest release in both files
 */
export async function feedFaults(tags: readonly string[], reach: Reach): Promise<string[]> {
  const newest = newestTagged(tags);
  if (newest === undefined) return ["This checkout holds no tag of a release: the website's files are compared with nothing."];

  const faults = await Promise.all([pinsFault(newest, reach), latestFault(newest, reach)]);

  return faults.filter((fault) => fault !== undefined);
}

if (import.meta.main) {
  const tags = Bun.spawnSync(["git", "tag", "--list"], { stderr: "inherit" });
  if (tags.exitCode !== 0) throw new Error("git could not list the tags of this checkout");

  const faults = await feedFaults(tags.stdout.toString().split("\n"), { fetch });

  for (const fault of faults) error(fault);
  if (faults.length === 0) console.log("The website names the newest release in releases.json and in latest.json.");
  process.exitCode = faults.length === 0 ? 0 : 1;
}
