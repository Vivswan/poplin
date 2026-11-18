// The older build a live upgrade starts from, put in a folder of its own and built there, and this checkout told a version above it and given one schema step more.
//
//   the older build   the one older-from.ts finds for what the run asks to start from: the last release, or the newest pre-release that is an earlier build
//   its folder        `git archive` of it, with its own lockfile installed and its own Worker built
//   this checkout     packages/cli/package.json told one patch above the older build's version, unless it is above it already
//                     and the later step of later-step.ts added to the file of the older build's version among the product's steps, so the update has a step to apply
//
// An install takes a release above its own version alone, and a commit of main says the version of the last release, as the older build does.
// A pre-release on npm is the command alone, with no built Worker and no line of the website's `releases.json`, so its Worker is built here from the commit.
// Where there is no build to start from, the step says so in one line, makes no folder, and sets no output: the steps after it are skipped.
// Argument: the folder the older build goes in, which must not be there yet. The step that runs this holds no secret.
// Step output: `older` (the tag or the commit of the older build, once its folder is built).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import { isPlainVersion } from "@poplin/core/src/records/update";
import gt from "semver/functions/gt";
import inc from "semver/functions/inc";

import { type Step, stepLabel } from "../../../core/src/migrations/migrate";
import { addLaterStep } from "./later-step";
import { olderFrom, readFrom } from "./older-from";

/** The file of a tree that says its version, from the tree's root. */
const VERSION_FILE = join("packages", "cli", "package.json");

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** The command whose versions npm is asked for. */
const COMMAND = "poplin";

/** Runs one command in a folder. It throws when the command fails. */
type RunCommand = (command: readonly string[], cwd: string) => void;

/**
 * Say the version this checkout's build is published under for an upgrade.
 *
 * @param own - the version this checkout says
 * @param older - the version the older build says
 * @returns `own` where it is above `older`, else one patch above `older`
 * @throws {Error} the older build's version is no plain version, which no install takes a release over
 */
export function versionAbove(own: string, older: string): string {
  const next = isPlainVersion(older) ? inc(older, "patch") : null;
  if (next === null) throw new Error(`the older build says the version ${older}, which is no plain version`);

  return isPlainVersion(own) && gt(own, older) ? own : next;
}

/** Read the version a tree says. */
export function versionOf(tree: string): string {
  const manifest: { readonly version?: unknown } = JSON.parse(readFileSync(join(tree, VERSION_FILE), "utf8"));
  if (typeof manifest.version !== "string") throw new Error(`${VERSION_FILE} of ${tree} names no version`);

  return manifest.version;
}

/** Write the version a tree says, and leave every other line of the file as it is. */
function tellVersion(tree: string, from: string, to: string): void {
  const file = join(tree, VERSION_FILE);
  const text = readFileSync(file, "utf8");
  const line = `"version": "${from}"`;
  if (text.split(line).length !== 2) throw new Error(`${VERSION_FILE} does not say its version on one line`);

  writeFileSync(file, text.replace(line, `"version": "${to}"`));
}

/**
 * Put the older build in a folder, build its Worker there, and tell this checkout a version above it and one schema step more.
 *
 * @param ref - the tag or the commit the older build is
 * @param folder - where it goes; removed again when a step fails
 * @returns the version the older build says, the one this checkout says now, and the later step this checkout holds now
 * @throws {Error} a command failed, with what it said
 */
export function prepareBuilds(root: string, ref: string, folder: string, run: RunCommand): { readonly older: string; readonly own: string; readonly step: Step } {
  if (existsSync(folder)) throw new Error(`${folder} is there already`);

  mkdirSync(folder, { recursive: true });

  try {
    const archive = join(folder, "tree.tar");
    run(["git", "archive", "--format=tar", `--output=${archive}`, ref], root);
    run(["tar", "-xf", archive, "-C", folder], folder);
    rmSync(archive);
    run([process.execPath, "install", "--frozen-lockfile"], folder);
    run([process.execPath, "run", "--cwd", join("packages", "providers", "cloudflare"), "build"], folder);
  } catch (cause) {
    rmSync(folder, { recursive: true, force: true });
    throw cause;
  }

  const [older, said] = [versionOf(folder), versionOf(root)];
  const own = versionAbove(said, older);
  if (own !== said) tellVersion(root, said, own);

  return { older, own, step: addLaterStep(root, older) };
}

/** Run one command, with what it prints on this process's own. */
function runCommand(command: readonly string[], cwd: string): void {
  const ran = Bun.spawnSync([...command], { cwd, stdio: ["ignore", "inherit", "inherit"] });
  if (ran.exitCode !== 0) throw new Error(`\`${command.join(" ")}\` failed with exit code ${ran.exitCode}`);
}

/** Ask npm for every version of the command: nothing where it did not answer. */
function npmVersions(): readonly string[] | undefined {
  const asked = Bun.spawnSync([process.execPath, "info", COMMAND, "versions", "--json"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] });
  if (asked.exitCode !== 0) return undefined;

  const versions: unknown = JSON.parse(asked.stdout.toString());

  return [versions].flat().filter((version) => typeof version === "string");
}

/** Find the older build, and build it where there is one. */
function main(folder: string): void {
  const start = olderFrom(ROOT, readFrom(process.env), npmVersions);
  console.log(start.line);
  if (start.kind === "none") return;

  const { older, own, step } = prepareBuilds(ROOT, start.ref, folder, runCommand);
  console.log(`The older build says the version ${older}`);
  console.log(`This commit's build: published for the upgrade as ${own}, with step ${stepLabel(step)} (${step.description}) for the upgrade alone`);
  if (process.env.GITHUB_OUTPUT) core.setOutput("older", start.ref);
}

if (import.meta.main) {
  const [folder] = process.argv.slice(2);
  if (folder === undefined) throw new Error("name the folder the older build goes in");

  main(folder);
}
