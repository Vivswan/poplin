// The deploy of the Worker. From a terminal it deploys the files it sits in. In Cloudflare's hosted build it deploys a release of poplin, with the copy's own account fields kept.
//
// THE FROZEN PART. An install's copy on GitHub never changes, so every release must go on answering what any earlier copy does in a hosted build:
//
//   reads     POPLIN_VERSION, the one build variable a person sets
//   fetches   the published digests from the project's website, and the release's files from GitHub
//   checks    the files against the digest published for that version, and runs none that differ
//   unpacks   the files into a new folder, then installs there with `bun install --frozen-lockfile`
//   runs      `bun run deploy` in that folder, with POPLIN_COPY_CONFIG set to the path of the copy's wrangler.jsonc
//
// The release's own deploy, handed POPLIN_COPY_CONFIG, fetches nothing: it lays the copy's fields over its configuration and deploys.

import { mkdtempDisposableSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { checkedRelease, newestPinned, type ReleasePins, type ReleaseRefusal } from "@poplin/core/src/records/release";
import * as v from "valibot";

import { parseAskedVersion } from "./asked-version";
import { type DeployConfig, keepCopyConfig } from "./kept-config";
import type { ReleaseSource } from "./release-source";

/** What Cloudflare's hosted build sets `WORKERS_CI` to. */
const HOSTED = "1";

/** The Worker's configuration, from the root of a tree. */
const CONFIG_FILE = "wrangler.jsonc";

/** The merged configuration of a handed-over deploy, beside the tree's own so its paths read the same. It is removed after the deploy. */
const MERGED_FILE = "wrangler.deploy.json";

/** The folder wrangler runs in, from the root of a tree. */
const PACKAGE = join("packages", "cloudflare");

/** The folder a release's archive holds its files in. */
const ARCHIVE_FOLDER = "poplin";

/** The file of a release that says its version, from the root of its archive. */
const VERSION_FILE = `${ARCHIVE_FOLDER}/packages/cli/package.json`;

/** What that file must hold to say a version. */
const VERSION_MANIFEST = v.object({ version: v.string() });

/** What ends every line of a deploy that stopped before wrangler ran. */
const NOTHING_DEPLOYED = "Nothing was deployed.";

/** Runs one command to its end, its output going where the build's goes. Answers its exit code. */
export type RunCommand = (command: readonly string[], options: { readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>> }) => Promise<number>;

/** One deploy: the tree it starts in, its environment, and its ways out to the world. */
export interface Deploy {
  /** The root of the tree this deploy's code sits in. */
  readonly root: string;

  /** The version of poplin that tree holds. */
  readonly version: string;

  /** The folder a fetched release gets a new folder of its own in, removed after the deploy. */
  readonly scratch: string;

  /** The environment of the process. */
  readonly env: Readonly<Record<string, string | undefined>>;

  /** What the command line added, passed on to wrangler. */
  readonly args: readonly string[];

  /** Where releases come from. */
  readonly source: ReleaseSource;

  /** Runs wrangler, and the install and the deploy of a fetched release. */
  readonly run: RunCommand;

  /** Prints one line. */
  readonly say: (line: string) => void;
}

function wrangler(deploy: Deploy, configFile: string): Promise<number> {
  return deploy.run(["wrangler", "deploy", "--config", configFile, ...deploy.args], { cwd: join(deploy.root, PACKAGE), env: deploy.env });
}

async function readConfig(file: string): Promise<DeployConfig | undefined> {
  try {
    const parsed: unknown = Bun.JSONC.parse(await Bun.file(file).text());

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as DeployConfig) : undefined;
  } catch {
    return undefined;
  }
}

/** Deploy this tree for the copy that fetched it: the copy's account fields over this tree's configuration. */
async function deployForCopy(deploy: Deploy, copyFile: string): Promise<number> {
  const release = await readConfig(join(deploy.root, CONFIG_FILE));
  const copy = await readConfig(copyFile);

  if (release === undefined || copy === undefined) {
    deploy.say(`poplin: the file ${CONFIG_FILE} of ${copy === undefined ? "your copy" : "the release"} could not be read. ${NOTHING_DEPLOYED} Put the file in your copy back as the install made it, then build again.`);
    return 1;
  }

  const merged = join(deploy.root, MERGED_FILE);
  writeFileSync(merged, JSON.stringify(keepCopyConfig(release, copy), null, 2));

  try {
    return await wrangler(deploy, merged);
  } finally {
    rmSync(merged, { force: true });
  }
}

/** Read the version an archive's files say they are; `undefined` for an archive that says none. */
async function versionOf(bytes: Uint8Array<ArrayBuffer>): Promise<string | undefined> {
  try {
    const manifest = v.safeParse(VERSION_MANIFEST, await (await new Bun.Archive(bytes).files()).get(VERSION_FILE)?.json());

    return manifest.success ? manifest.output.version : undefined;
  } catch {
    return undefined;
  }
}

/** The line of a release that was not taken. `says` is the version its files gave. */
function refusalLine(refusal: Exclude<ReleaseRefusal, "older">, version: string, says: string | undefined): string {
  const lines: Readonly<Record<typeof refusal, string>> = {
    no_digest: `no digest is published for release ${version}, so its files cannot be checked. ${NOTHING_DEPLOYED} Check that ${version} is a release of poplin, then build again; the website names poplin's own releases, each up to a day after it is out.`,
    unreachable: `release ${version} could not be fetched from github.com. ${NOTHING_DEPLOYED} Build again in a few minutes.`,
    digest_differs: `the files fetched for release ${version} are not the files poplin published: their SHA-256 digest differs. ${NOTHING_DEPLOYED} Build again; if it says this again, tell the project.`,
    other_version: `the files published as release ${version} say they are ${says === undefined ? "no version" : `version ${JSON.stringify(says)}`}. ${NOTHING_DEPLOYED} Tell the project.`,
  };

  return `poplin: ${lines[refusal]}`;
}

/** Answer a release that was not taken: the copy's own files for a newest release older than the copy, and for every other refusal one line and no deploy. */
function deployNotTaken(deploy: Deploy, version: string, refused: { readonly refusal: ReleaseRefusal; readonly says?: string }): Promise<number> {
  if (refused.refusal === "older") {
    deploy.say(`poplin: the newest published release, ${version}, is older than your copy (${deploy.version}); deploying your copy's own files`);
    return wrangler(deploy, join(deploy.root, CONFIG_FILE));
  }

  deploy.say(refusalLine(refused.refusal, version, refused.says));
  return Promise.resolve(1);
}

/** Fetch a release, take it only with the published digest, install it, and hand the deploy over to the release's own code. `asked` is the word the build asked with, and `running` the version a build of the newest release never goes below. */
async function deployRelease(deploy: Deploy, pins: ReleasePins, wanted: { readonly version: string; readonly running?: string }, asked: string): Promise<number> {
  const { version } = wanted;
  const release = await checkedRelease(wanted, pins, { fetch: deploy.source.fetch, versionOf });
  if (!release.ok) return deployNotTaken(deploy, version, release);

  using scratch = mkdtempDisposableSync(join(deploy.scratch, "poplin-release-"));
  const tree = join(scratch.path, ARCHIVE_FOLDER);
  await new Bun.Archive(release.bytes).extract(scratch.path);

  if ((await deploy.run(["bun", "install", "--frozen-lockfile"], { cwd: tree, env: deploy.env })) !== 0) {
    deploy.say(`poplin: what release ${version} needs could not be installed. ${NOTHING_DEPLOYED} Build again in a few minutes.`);
    return 1;
  }

  deploy.say(`poplin: deploying ${version} (was asked for ${asked})`);

  return await deploy.run(["bun", "run", "deploy", ...deploy.args], { cwd: tree, env: { ...deploy.env, POPLIN_COPY_CONFIG: join(deploy.root, CONFIG_FILE) } });
}

/** Deploy the newest release the website names, or the copy's own files while it names none or the newest is older than the copy. */
function deployNewest(deploy: Deploy, pins: ReleasePins): Promise<number> {
  const newest = newestPinned(pins);

  if (newest === undefined) {
    deploy.say("poplin: poplin's website names no release yet; deploying your copy's own files");
    return wrangler(deploy, join(deploy.root, CONFIG_FILE));
  }

  return deployRelease(deploy, pins, { version: newest, running: deploy.version }, "latest");
}

/**
 * Deploy the Worker. Outside the hosted build nothing is fetched and no variable is read: wrangler deploys this tree as it is.
 *
 * @returns the exit code of the process: wrangler's own, or 1 with one line said when the deploy stopped before wrangler
 */
export async function deployWorker(deploy: Deploy): Promise<number> {
  if (deploy.env.WORKERS_CI !== HOSTED) return wrangler(deploy, join(deploy.root, CONFIG_FILE));

  const copyFile = deploy.env.POPLIN_COPY_CONFIG;
  if (copyFile !== undefined && copyFile !== "") return deployForCopy(deploy, copyFile);

  const asked = parseAskedVersion(deploy.env.POPLIN_VERSION);

  if (asked === undefined) {
    deploy.say(`poplin: the build variable POPLIN_VERSION is ${JSON.stringify(deploy.env.POPLIN_VERSION)}. ${NOTHING_DEPLOYED} Set it to latest, to this, or to a version like 0.2.0, then build again.`);
    return 1;
  }

  if (asked.kind === "this") {
    deploy.say("poplin: deploying your copy's own files (was asked for this)");
    return wrangler(deploy, join(deploy.root, CONFIG_FILE));
  }

  const pins = await deploy.source.pins();

  if (pins === undefined) {
    deploy.say(`poplin: poplin's website did not say which releases are published. ${NOTHING_DEPLOYED} Build again in a few minutes.`);
    return 1;
  }

  if (asked.kind === "exact") return deployRelease(deploy, pins, { version: asked.version }, asked.version);

  return deployNewest(deploy, pins);
}
