import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { type ReleasePins, releaseDigest } from "@poplin/core/src/records/release";

import { type Deploy, deployWorker } from "../../src/deploy/deploy";
import type { ReleaseSource } from "../../src/deploy/release-source";

/** The configuration of the tree a deploy starts in, with a comment as the real file has. */
const OWN_CONFIG = '{\n  // The Worker.\n  "name": "poplin",\n  "compatibility_date": "2027-03-01",\n  "d1_databases": [{ "binding": "DB", "database_name": "poplin" }]\n}\n';

/** The configuration of an install's copy: older, with the id the Deploy button wrote. */
const COPY_CONFIG = '{ "name": "poplin", "compatibility_date": "2026-11-01", "d1_databases": [{ "binding": "DB", "database_name": "poplin", "database_id": "11111111-2222-3333-4444-555555555555" }] }';

/** The one command of a deploy that deploys the tree it sits in, as it is. */
const OWN_FILES: Ran = {
  command: ["wrangler", "deploy", "--config", join("<root>", "wrangler.jsonc")],
  cwd: join("<root>", "packages", "cloudflare"),
  handed: undefined,
  config: { name: "poplin", compatibility_date: "2027-03-01", d1_databases: [{ binding: "DB", database_name: "poplin" }] },
};

/** The two commands that follow a fetched release: its install, then its own deploy with the copy's configuration handed over. */
const RELEASE_COMMANDS: readonly Ran[] = [
  { command: ["bun", "install", "--frozen-lockfile"], cwd: join("<scratch>", "poplin"), handed: undefined, config: undefined, unpacked: true },
  { command: ["bun", "run", "deploy"], cwd: join("<scratch>", "poplin"), handed: join("<root>", "wrangler.jsonc"), config: undefined, unpacked: true },
];

/** The archive packed for each version a scene's files say, kept for the whole run. */
const PACKED = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

/** What the website published in most scenes: three versions, each with the digest of its own files. */
const THREE_RELEASES = { "0.2.0": "0.2.0", "0.3.0": "0.3.0", "0.3.1": "0.3.1" };

/** One command a deploy ran: its words, where, the copy's configuration it was handed, what its `--config` file held at that moment, and for a command of a fetched release whether the release's files were in its folder. */
interface Ran {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly handed: string | undefined;
  readonly config: unknown;
  readonly unpacked?: boolean;
}

/** What a deploy did, seen from outside. */
interface Outcome {
  readonly code: number;
  readonly said: readonly string[];
  readonly ran: readonly Ran[];
  readonly asked: readonly string[];
  readonly left: readonly string[];
}

/** A scene a deploy runs in: its variables, the copy's version, what the website published and what GitHub serves, and which command fails. */
interface Scene {
  /** The variables of the build. */
  readonly env: Readonly<Record<string, string | undefined>>;

  /** The version of the copy the deploy starts in; `0.1.0` when left out. */
  readonly copy?: string;

  /** The versions the website names, each with the version its published digest was made over; left out for a website with no answer. */
  readonly published?: Readonly<Record<string, string>>;

  /** The versions GitHub serves files for, each with the version those files say they are; the published ones when left out. */
  readonly served?: Readonly<Record<string, string>>;

  /** Whether one bit of every served archive is changed. */
  readonly changed?: true;

  /** A word of the one command that fails. */
  readonly failing?: string;
}

async function pack(says: string): Promise<Uint8Array<ArrayBuffer>> {
  const files = { "poplin/wrangler.jsonc": OWN_CONFIG, ...(says === "none" ? {} : { "poplin/packages/cli/package.json": JSON.stringify({ name: "poplin", version: says }) }) };

  return new Uint8Array(await new Bun.Archive(files, { compress: "gzip" }).bytes());
}

/**
 * The archive of a release: its files in one folder, with the file that says its version. `says` of `none` leaves that file out.
 *
 * An archive holds the second it was packed in, so each is packed once: the digest the website names and the bytes GitHub serves are of the same pack. Every call gets its own copy.
 */
async function archiveOf(says: string): Promise<Uint8Array<ArrayBuffer>> {
  const packed = PACKED.get(says) ?? pack(says);
  PACKED.set(says, packed);

  return (await packed).slice();
}

/** The website's file for a scene: each version with the digest of the archive that says the version given for it. A hosted build reads the digest of the source alone, so the other two are any that pass. */
async function pinsOf(published: Readonly<Record<string, string>>): Promise<ReleasePins> {
  const entries = await Promise.all(Object.entries(published).map(async ([version, says]) => [version, { source: await releaseDigest(await archiveOf(says)), bundle: "0".repeat(64), schema: 1 }] as const));

  return Object.fromEntries(entries);
}

/** A path with the scene's own folders named, so an outcome holds no folder of the machine. Its separators stay the system's own, as the expected paths are joined. */
function named(path: string, root: string, scratch: string): string {
  const [first, ...rest] = relative(scratch, path).split(sep);

  return /^poplin-release-.+$/.test(first ?? "") ? join("<scratch>", ...rest) : path.replace(root, "<root>");
}

/** Run one deploy in a new tree with a fake release source and a recorder for its commands. Nothing reaches the network or starts a process. */
async function play(scene: Scene): Promise<Outcome> {
  using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-deploy-test-"));
  const root = join(folder.path, "root");
  const scratch = join(folder.path, "scratch");
  mkdirSync(root);
  mkdirSync(scratch);
  writeFileSync(join(root, "wrangler.jsonc"), OWN_CONFIG);
  writeFileSync(join(folder.path, "copy.jsonc"), COPY_CONFIG);

  const said: string[] = [];
  const ran: Ran[] = [];
  const asked: string[] = [];

  const pins = scene.published === undefined ? undefined : await pinsOf(scene.published);
  const served = scene.served ?? scene.published ?? {};

  const source: ReleaseSource = {
    pins: () => {
      asked.push("pins");
      return Promise.resolve(pins);
    },
    fetch: async (version) => {
      asked.push(`fetch ${version}`);
      const says = served[version];
      if (says === undefined) return undefined;

      const bytes = await archiveOf(says);
      if (scene.changed === true) bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;

      return bytes;
    },
  };

  const deploy: Deploy = {
    root,
    version: scene.copy ?? "0.1.0",
    scratch,
    env: Object.fromEntries(Object.entries(scene.env).map(([name, value]) => [name, value?.replace("<folder>", folder.path)])),
    args: [],
    source,
    say: (line) => said.push(line),
    run: (command, options) => {
      const file = command[command.indexOf("--config") + 1];
      const config = command.includes("--config") && file !== undefined ? Bun.JSONC.parse(readFileSync(file, "utf8")) : undefined;
      const handed = options.env.POPLIN_COPY_CONFIG?.replace(root, "<root>").replace(folder.path, "<folder>");
      const unpacked = command[0] === "bun" ? existsSync(join(options.cwd, "wrangler.jsonc")) : undefined;
      ran.push({ command: command.map((word) => named(word, root, scratch)), cwd: named(options.cwd, root, scratch), handed, config, ...(unpacked === undefined ? {} : { unpacked }) });

      return Promise.resolve(command.includes(scene.failing ?? "") ? 3 : 0);
    },
  };

  const code = await deployWorker(deploy);

  return { code, said, ran, asked, left: [...readdirSync(root), ...readdirSync(scratch)] };
}

describe("deployWorker", () => {
  const outside: readonly { readonly name: string; readonly env: Scene["env"] }[] = [
    { name: "no variable at all", env: {} },
    { name: "a version asked for", env: { POPLIN_VERSION: "0.2.0" } },
    { name: "a value that is no version", env: { POPLIN_VERSION: "newest" } },
    { name: "a copy's configuration handed over", env: { POPLIN_COPY_CONFIG: "<folder>/copy.jsonc" } },
    { name: "the build's marker set to another value", env: { WORKERS_CI: "0", POPLIN_VERSION: "0.2.0" } },
    { name: "another system's marker", env: { CI: "true", GITHUB_ACTIONS: "true", POPLIN_VERSION: "0.2.0" } },
  ];

  // Drift: a terminal, this repository's own checks, and the live checks all deploy the files in front of them; a fetch there would deploy something nobody was looking at.
  test.each(outside)("outside the hosted build, with $name, wrangler deploys the tree as it is: nothing is asked of the release source and nothing is said", async ({ env }) => {
    expect(await play({ env })).toEqual({ code: 0, said: [], ran: [{ ...OWN_FILES, handed: env.POPLIN_COPY_CONFIG }], asked: [], left: ["wrangler.jsonc"] });
  });

  const hosted: readonly { readonly name: string; readonly scene: Scene; readonly outcome: Outcome }[] = [
    {
      name: "no variable, and three published releases",
      scene: { env: { WORKERS_CI: "1" }, published: THREE_RELEASES },
      outcome: { code: 0, said: ["poplin: deploying 0.3.1 (was asked for latest)"], ran: RELEASE_COMMANDS, asked: ["pins", "fetch 0.3.1"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`latest`, and three published releases",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" }, published: THREE_RELEASES },
      outcome: { code: 0, said: ["poplin: deploying 0.3.1 (was asked for latest)"], ran: RELEASE_COMMANDS, asked: ["pins", "fetch 0.3.1"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`latest`, from a copy of the newest release's own version",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" }, copy: "0.3.1", published: THREE_RELEASES },
      outcome: { code: 0, said: ["poplin: deploying 0.3.1 (was asked for latest)"], ran: RELEASE_COMMANDS, asked: ["pins", "fetch 0.3.1"], left: ["wrangler.jsonc"] },
    },
    {
      name: "a version, older than the newest release and than the copy: a person's word takes an install back",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.2.0" }, copy: "0.3.0", published: THREE_RELEASES },
      outcome: { code: 0, said: ["poplin: deploying 0.2.0 (was asked for 0.2.0)"], ran: RELEASE_COMMANDS, asked: ["pins", "fetch 0.2.0"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`this`",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "this" }, published: THREE_RELEASES },
      outcome: { code: 0, said: ["poplin: deploying your copy's own files (was asked for this)"], ran: [OWN_FILES], asked: [], left: ["wrangler.jsonc"] },
    },
    {
      name: "no variable, and a website that names no release yet",
      scene: { env: { WORKERS_CI: "1" }, published: {} },
      outcome: { code: 0, said: ["poplin: poplin's website names no release yet; deploying your copy's own files"], ran: [OWN_FILES], asked: ["pins"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`latest`, and a website that names no release yet",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" }, published: {} },
      outcome: { code: 0, said: ["poplin: poplin's website names no release yet; deploying your copy's own files"], ran: [OWN_FILES], asked: ["pins"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`latest`, from a copy newer than every published release: the build never goes below the copy",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" }, copy: "0.4.0", published: THREE_RELEASES },
      outcome: { code: 0, said: ["poplin: the newest published release, 0.3.1, is older than your copy (0.4.0); deploying your copy's own files"], ran: [OWN_FILES], asked: ["pins"], left: ["wrangler.jsonc"] },
    },
    {
      name: "a release whose own deploy fails",
      scene: { env: { WORKERS_CI: "1" }, published: THREE_RELEASES, failing: "deploy" },
      outcome: { code: 3, said: ["poplin: deploying 0.3.1 (was asked for latest)"], ran: RELEASE_COMMANDS, asked: ["pins", "fetch 0.3.1"], left: ["wrangler.jsonc"] },
    },
  ];

  // Drift: the copy on GitHub never changes, so these commands and the handed-over variable are what every later release is run with.
  test.each(hosted)("in the hosted build, with $name, the deploy says which version and runs exactly these commands in the release's unpacked files, and its scratch folder is gone after", async ({ scene, outcome }) => {
    expect(await play(scene)).toEqual(outcome);
  });

  const stopped: readonly { readonly name: string; readonly scene: Scene; readonly said: readonly string[]; readonly asked: readonly string[]; readonly ran: readonly Ran[] }[] = [
    {
      name: "a value that is no version",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "v0.2.0" } },
      said: ['poplin: the build variable POPLIN_VERSION is "v0.2.0". Nothing was deployed. Set it to latest, to this, or to a version like 0.2.0, then build again.'],
      asked: [],
      ran: [],
    },
    {
      name: "a website that does not say which releases are published",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" } },
      said: ["poplin: poplin's website did not say which releases are published. Nothing was deployed. Build again in a few minutes."],
      asked: ["pins"],
      ran: [],
    },
    {
      name: "a website that does not say, with a version asked for: a version is not taken on its name",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.2.0" }, served: THREE_RELEASES },
      said: ["poplin: poplin's website did not say which releases are published. Nothing was deployed. Build again in a few minutes."],
      asked: ["pins"],
      ran: [],
    },
    {
      name: "a version GitHub serves files for and the website published no digest for, as a release made by hand is",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.9.9" }, published: THREE_RELEASES, served: { "0.9.9": "0.9.9" } },
      said: ["poplin: no digest is published for release 0.9.9, so its files cannot be checked. Nothing was deployed. Check that 0.9.9 is a release of poplin, then build again; the website names poplin's own releases, each up to a day after it is out."],
      asked: ["pins"],
      ran: [],
    },
    {
      name: "the newest release with one bit of its files changed",
      scene: { env: { WORKERS_CI: "1" }, published: THREE_RELEASES, changed: true },
      said: ["poplin: the files fetched for release 0.3.1 are not the files poplin published: their SHA-256 digest differs. Nothing was deployed. Build again; if it says this again, tell the project."],
      asked: ["pins", "fetch 0.3.1"],
      ran: [],
    },
    {
      name: "a version whose page serves the files of an older release",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.3.1" }, published: THREE_RELEASES, served: { "0.3.1": "0.2.0" } },
      said: ["poplin: the files fetched for release 0.3.1 are not the files poplin published: their SHA-256 digest differs. Nothing was deployed. Build again; if it says this again, tell the project."],
      asked: ["pins", "fetch 0.3.1"],
      ran: [],
    },
    {
      name: "a digest published for the files of another version",
      scene: { env: { WORKERS_CI: "1" }, published: { "0.3.1": "0.2.0" } },
      said: ['poplin: the files published as release 0.3.1 say they are version "0.2.0". Nothing was deployed. Tell the project.'],
      asked: ["pins", "fetch 0.3.1"],
      ran: [],
    },
    {
      name: "a digest published for files that say no version",
      scene: { env: { WORKERS_CI: "1" }, published: { "0.3.1": "none" } },
      said: ["poplin: the files published as release 0.3.1 say they are no version. Nothing was deployed. Tell the project."],
      asked: ["pins", "fetch 0.3.1"],
      ran: [],
    },
    {
      name: "a release whose files cannot be fetched",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.3.0" }, published: THREE_RELEASES, served: {} },
      said: ["poplin: release 0.3.0 could not be fetched from github.com. Nothing was deployed. Build again in a few minutes."],
      asked: ["pins", "fetch 0.3.0"],
      ran: [],
    },
    {
      name: "a release whose install fails",
      scene: { env: { WORKERS_CI: "1" }, published: THREE_RELEASES, failing: "install" },
      said: ["poplin: what release 0.3.1 needs could not be installed. Nothing was deployed. Build again in a few minutes."],
      asked: ["pins", "fetch 0.3.1"],
      ran: RELEASE_COMMANDS.slice(0, 1),
    },
    {
      name: "a handed-over configuration that is no file",
      scene: { env: { WORKERS_CI: "1", POPLIN_COPY_CONFIG: "<folder>/gone.jsonc" } },
      said: ["poplin: the file wrangler.jsonc of your copy could not be read. Nothing was deployed. Put the file in your copy back as the install made it, then build again."],
      asked: [],
      ran: [],
    },
  ];

  // Drift: old code refuses a newer database, and files nobody published would run with the build's account: a build that deployed either after a refusal would take the install down, or over.
  test.each(stopped)("in the hosted build, $name fails the build with one line that says what to do, and neither wrangler nor any file of the release runs", async ({ scene, said, asked, ran }) => {
    expect(await play(scene)).toEqual({ code: 1, said, ran, asked, left: ["wrangler.jsonc"] });
  });

  const handed: readonly { readonly name: string; readonly env: Scene["env"] }[] = [
    { name: "nothing else", env: {} },
    { name: "the newest release asked for, as the copy's build has it", env: { POPLIN_VERSION: "latest" } },
    { name: "a version asked for", env: { POPLIN_VERSION: "0.2.0" } },
    { name: "a value that is no version, which the copy's deploy already answered", env: { POPLIN_VERSION: "newest" } },
  ];

  // Drift: a release that fetched again when handed a copy's configuration would fetch itself without end; one that deployed its own configuration would make a new empty database.
  test.each(handed)("a release handed a copy's configuration, with $name, fetches nothing: it deploys its own files under the copy's database id, and leaves no merged file behind", async ({ env }) => {
    const merged = { name: "poplin", compatibility_date: "2027-03-01", d1_databases: [{ binding: "DB", database_name: "poplin", database_id: "11111111-2222-3333-4444-555555555555" }] };
    const ran: Ran = { command: ["wrangler", "deploy", "--config", join("<root>", "wrangler.deploy.json")], cwd: join("<root>", "packages", "cloudflare"), handed: "<folder>/copy.jsonc", config: merged };

    expect(await play({ env: { WORKERS_CI: "1", POPLIN_COPY_CONFIG: "<folder>/copy.jsonc", ...env }, published: THREE_RELEASES })).toEqual({ code: 0, said: [], ran: [ran], asked: [], left: ["wrangler.jsonc"] });
  });
});
