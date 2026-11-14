/** The publish step as one call: the channel's verdict, the publish it allows, and the wait that holds the lane. */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { join } from "node:path";
import { awaitVersion } from "./await-version.js";
import { MANIFEST_FILE, OIDC_REQUEST_URL, PACKAGE_DIR } from "./constants.js";
import { assertCheckoutAt, git, gitAncestry, mainPosition } from "./git.js";
import { manifestVersion } from "./manifest-version.js";
import { nextConfirmVerdict } from "./next-confirm-verdict.js";
import { nextPublishVerdict } from "./next-verdict.js";
import { prereleaseVersion } from "./prerelease-version.js";
import type { Ancestry, ConfirmVerdict, NextVerdict, Packument } from "./records.js";
import { fetchPackument } from "./registry.js";
import { releaseVersion } from "./release-version.js";
import { stablePublishVerdict } from "./stable-verdict.js";
import { isRecord } from "./util.js";

/** One publish: where from, what, and how long to wait for the registry to show it. */
export type NpmPublishOptions = {
  /** The checkout's root; npm runs in its package folder. */
  cwd: string;

  /** The full sha of the commit whose build is published; the checkout must be at it. */
  sourceSha: string;

  /** The registry's base URL, where the package's record is read. */
  registry: string;

  /** The job's OIDC request URL; undefined or empty when the job was granted no `id-token: write`. */
  oidcRequestUrl: string | undefined;

  /** The bound on the registry reads after the publish. */
  confirm: { attempts: number; delayMs: number };
} & ({ channel: "next" } | { channel: "stable"; tag: string });

/** What the step did: nothing, with the reason, or a publish with what the registry showed after it. */
export type NpmPublishResult =
  | { published: false; version: string; reason: string }
  | { published: true; version: string; confirmed: ConfirmVerdict };

interface PackageFacts {
  name: string;
  version: string;
}

function packageAtHead(cwd: string): PackageFacts {
  const path = `${PACKAGE_DIR}/package.json`;
  const pkg: unknown = JSON.parse(git(cwd, "show", `HEAD:${path}`));

  if (!isRecord(pkg) || typeof pkg.name !== "string" || typeof pkg.version !== "string") {
    throw new Error(`${path} at the source commit lacks a string name or version; refusing to publish from it.`);
  }

  return { name: pkg.name, version: pkg.version };
}

function versionToPublish(options: NpmPublishOptions, pkg: PackageFacts): string {
  const { cwd, sourceSha } = options;

  if (options.channel === "stable") {
    return releaseVersion(options.tag, pkg.version);
  }

  const released = manifestVersion(git(cwd, "show", `HEAD:${MANIFEST_FILE}`));

  return prereleaseVersion(released, mainPosition(cwd, sourceSha), sourceSha);
}

function judge(options: NpmPublishOptions, version: string, ancestry: Ancestry, packument: Packument | null): NextVerdict {
  if (options.channel === "stable") {
    return { ...stablePublishVerdict(version, packument), notices: [] };
  }

  return nextPublishVerdict(ancestry, options.sourceSha, version, packument);
}

function endedHow(result: SpawnSyncReturns<unknown>): string {
  const how = result.status === null ? `died of ${result.signal}` : `exited ${result.status}`;

  if (result.error === undefined) {
    return how;
  }

  return `${how} (${result.error.message})`;
}

function npm(cwd: string, env: Record<string, string>, ...args: string[]): void {
  const result = spawnSync("npm", args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} ${endedHow(result)}; see npm's output above.`);
  }
}

/** GITHUB_SHA on the publish is the commit npm's provenance names. */
function publish(options: NpmPublishOptions, version: string): void {
  const packageDir = join(options.cwd, PACKAGE_DIR);
  const source = { GITHUB_SHA: options.sourceSha };

  if (options.channel === "stable") {
    npm(packageDir, source, "publish");
    return;
  }

  npm(packageDir, {}, "pkg", "set", `version=${version}`);
  npm(packageDir, source, "publish", "--tag", "next");
}

function unsettled(options: NpmPublishOptions, version: string): ConfirmVerdict {
  const { attempts, delayMs } = options.confirm;
  const waited = `the registry's record still lacks ${version} after ${attempts} reads over ${Math.round(((attempts - 1) * delayMs) / 1000)} s`;

  if (options.channel === "stable") {
    return { outcome: "unsettled", version, reason: `${waited}; a rerun judged before it shows would publish it again and npm would refuse` };
  }

  return {
    outcome: "unsettled",
    version,
    reason: `${waited}; a run judged before it shows may move next back, and the push to main after it moves next forward`,
  };
}

/**
 * Publishes the checkout's package under the channel's dist-tag, unless the registry's record says not to.
 *
 * The verdict's notices reach `notice` before npm runs, so a publish that fails still leaves them on the log. After a
 * publish the record is read until it shows the version, so the next job in the publish lane judges a record with it.
 *
 * @param notice - takes one line for each published pre-release the verdict set aside
 * @throws {Error} no OIDC request URL, a checkout that is shallow or not at the source, a version or tag the pipeline
 *   refuses, a registry that answers neither 200 nor 404, or an npm command that fails
 */
export async function npmPublish(options: NpmPublishOptions, notice: (line: string) => void): Promise<NpmPublishResult> {
  const { cwd, sourceSha, registry } = options;

  if (options.oidcRequestUrl === undefined || options.oidcRequestUrl === "") {
    throw new Error(
      `${OIDC_REQUEST_URL} is not set, so this job has no OIDC token: npm trusted publishing is the only way this pipeline publishes, and no npm token is read. Grant the job id-token: write.`,
    );
  }

  assertCheckoutAt(cwd, sourceSha);

  const pkg = packageAtHead(cwd);
  const version = versionToPublish(options, pkg);
  const ancestry = gitAncestry(cwd);
  const read = (): Promise<Packument | null> => fetchPackument(registry, pkg.name);

  const verdict = judge(options, version, ancestry, await read());

  for (const line of verdict.notices) {
    notice(line);
  }

  if (!verdict.publish) {
    return { published: false, version, reason: verdict.reason };
  }

  publish(options, version);

  const shown = await awaitVersion({ read, version, ...options.confirm });

  if (shown === null) {
    return { published: true, version, confirmed: unsettled(options, version) };
  }

  if (options.channel === "stable") {
    return { published: true, version, confirmed: { outcome: "settled", version, reads: shown.reads } };
  }

  const published = { name: pkg.name, sourceSha, version, reads: shown.reads };

  return { published: true, version, confirmed: nextConfirmVerdict(ancestry, published, shown.packument) };
}
