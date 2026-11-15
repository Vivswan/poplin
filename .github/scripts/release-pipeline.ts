/**
 * The npm release pipeline's entry: each subcommand is the whole `run:` of one workflow step.
 *
 *   npm-floor            -> fails unless the npm on PATH can publish through OIDC (11.5.1 or newer)
 *   prerelease-version   -> prints the version the commit's build publishes under `next`
 *   npm-publish next     -> publishes X.Y.(Z+1)-main.<count>.<date>.g<sha7> under `next`
 *   npm-publish stable   -> publishes package.json's version, which the release tag must name, under `latest`
 *
 * Runs under bun, never plain node: the version order is Bun.semver's, and nothing here is compiled first.
 * Publishing is npm trusted publishing (OIDC) alone; no npm token is read.
 */

import * as core from "@actions/core";

import { CONFIRM_PAUSE_MS, CONFIRM_READS, DEFAULT_REGISTRY, MANIFEST_FILE, NPM_FLOOR, OIDC_REQUEST_URL } from "./release-pipeline/constants.js";
import { assertCheckoutAt, git, mainPosition } from "./release-pipeline/git.js";
import { manifestVersion } from "./release-pipeline/manifest-version.js";
import { npmFloor } from "./release-pipeline/npm-floor.js";
import { type NpmPublishOptions, npmPublish } from "./release-pipeline/npm-publish.js";
import { prereleaseVersion } from "./release-pipeline/prerelease-version.js";
import type { Channel, ConfirmVerdict } from "./release-pipeline/records.js";
import { requireEnv } from "./release-pipeline/util.js";

const SCRIPT = "release-pipeline";

/** One subcommand: the exit status it returns, or the refusal it throws. */
type Handler = (args: readonly string[]) => number | Promise<number>;

function confirmPauseMs(value: string | undefined): number {
  if (value === undefined || value === "") {
    return CONFIRM_PAUSE_MS;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`NPM_CONFIRM_PAUSE_MS must be a whole number of milliseconds, not ${JSON.stringify(value)}`);
  }

  return Number(value);
}

function publishOptions(channel: Channel): NpmPublishOptions {
  const shared = {
    cwd: process.cwd(),
    sourceSha: requireEnv("GITHUB_SHA"),
    registry: process.env.NPM_REGISTRY_URL || DEFAULT_REGISTRY,
    oidcRequestUrl: process.env[OIDC_REQUEST_URL],
    confirm: { attempts: CONFIRM_READS, delayMs: confirmPauseMs(process.env.NPM_CONFIRM_PAUSE_MS) },
  };

  if (channel === "stable") {
    return { ...shared, channel, tag: requireEnv("TAG") };
  }

  return { ...shared, channel };
}

/** The confirmation as a workflow annotation; 1 when next sits behind a descendant's pre-release. */
function reportConfirmed(channel: Channel, confirmed: ConfirmVerdict): number {
  if (confirmed.outcome === "behind") {
    core.error(confirmed.reason);

    return 1;
  }

  if (confirmed.outcome === "unsettled") {
    core.warning(confirmed.reason);

    return 0;
  }

  const reads = confirmed.reads === 1 ? "1 read" : `${confirmed.reads} reads`;
  const standing = channel === "next" ? "; next is not behind a descendant's pre-release" : "";
  core.notice(`${confirmed.version} is on the registry after ${reads}${standing}`);

  return 0;
}

async function npmPublishCommand([channel]: readonly string[]): Promise<number> {
  if (channel !== "next" && channel !== "stable") {
    throw new Error(`npm-publish takes the channel, next or stable, not ${JSON.stringify(channel ?? null)}`);
  }

  const result = await npmPublish(publishOptions(channel), (line) => console.error(line));

  if (result.published) {
    return reportConfirmed(channel, result.confirmed);
  }

  // A skipped pre-release is routine (a stale retry); a skipped release is a rerun worth a look.
  const annotate = channel === "next" ? core.notice : core.warning;
  annotate(result.reason);

  return 0;
}

function npmFloorCommand(): number {
  const result = npmFloor();

  if (result.atFloor) {
    return 0;
  }

  core.error(`npm ${result.version} cannot publish through OIDC; trusted publishing needs npm ${NPM_FLOOR} or newer. Install one in the workflow before this step.`);

  return 1;
}

function prereleaseVersionCommand(): number {
  const cwd = process.cwd();
  const sourceSha = requireEnv("GITHUB_SHA");
  assertCheckoutAt(cwd, sourceSha);

  const released = manifestVersion(git(cwd, "show", `HEAD:${MANIFEST_FILE}`));
  console.log(prereleaseVersion(released, mainPosition(cwd, sourceSha), sourceSha));

  return 0;
}

/** Sets the exit status, never exits: the last stdout lines drain through a pipe before the process ends. */
async function dispatch(commands: Readonly<Record<string, Handler>>, argv: readonly string[]): Promise<void> {
  const [command, ...args] = argv;
  const handler = command !== undefined && Object.hasOwn(commands, command) ? commands[command] : undefined;

  if (command === undefined || handler === undefined) {
    const given = command === undefined ? "no command given" : `unknown command ${JSON.stringify(command)}`;
    console.error(`${SCRIPT}: ${given}; expected ${Object.keys(commands).join(" | ")}`);
    process.exitCode = 1;
    return;
  }

  try {
    process.exitCode = await handler(args);
  } catch (error) {
    console.error(`${SCRIPT} ${command}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

/** The subcommands by name: the set a workflow step may run. */
export const COMMANDS: Readonly<Record<string, Handler>> = {
  "npm-floor": npmFloorCommand,
  "prerelease-version": prereleaseVersionCommand,
  "npm-publish": npmPublishCommand,
};

if (import.meta.main) {
  await dispatch(COMMANDS, process.argv.slice(2));
}
