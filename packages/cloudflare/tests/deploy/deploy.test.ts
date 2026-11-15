import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { type Deploy, deployWorker } from "../../src/deploy/deploy";
import type { Latest, ReleaseSource } from "../../src/deploy/release-source";

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
  { command: ["bun", "install", "--frozen-lockfile"], cwd: join("<scratch>", "poplin"), handed: undefined, config: undefined },
  { command: ["bun", "run", "deploy"], cwd: join("<scratch>", "poplin"), handed: join("<root>", "wrangler.jsonc"), config: undefined },
];

/** One command a deploy ran: its words, where, the copy's configuration it was handed, and what its `--config` file held at that moment. */
interface Ran {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly handed: string | undefined;
  readonly config: unknown;
}

/** What a deploy did, seen from outside. */
interface Outcome {
  readonly code: number;
  readonly said: readonly string[];
  readonly ran: readonly Ran[];
  readonly asked: readonly string[];
  readonly left: readonly string[];
}

/** A scene a deploy runs in: its variables, what the release source answers, and which command fails. */
interface Scene {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly latest?: Latest;
  readonly fetched?: boolean;
  readonly failing?: string;
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

  const source: ReleaseSource = {
    latest: () => {
      asked.push("latest");
      return Promise.resolve(scene.latest ?? { kind: "unknown" });
    },
    fetchInto: (version, into) => {
      asked.push(`fetch ${version}`);
      if (scene.fetched !== false) mkdirSync(into);
      return Promise.resolve(scene.fetched !== false);
    },
  };

  const deploy: Deploy = {
    root,
    scratch,
    env: Object.fromEntries(Object.entries(scene.env).map(([name, value]) => [name, value?.replace("<folder>", folder.path)])),
    args: [],
    source,
    say: (line) => said.push(line),
    run: (command, options) => {
      const file = command[command.indexOf("--config") + 1];
      const config = command.includes("--config") && file !== undefined ? Bun.JSONC.parse(readFileSync(file, "utf8")) : undefined;
      const handed = options.env.POPLIN_COPY_CONFIG?.replace(root, "<root>").replace(folder.path, "<folder>");
      ran.push({ command: command.map((word) => named(word, root, scratch)), cwd: named(options.cwd, root, scratch), handed, config });

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
      name: "no variable, and a newest release",
      scene: { env: { WORKERS_CI: "1" }, latest: { kind: "release", version: "0.3.1" } },
      outcome: { code: 0, said: ["poplin: deploying 0.3.1 (was asked for latest)"], ran: RELEASE_COMMANDS, asked: ["latest", "fetch 0.3.1"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`latest`, and a newest release",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" }, latest: { kind: "release", version: "0.3.1" } },
      outcome: { code: 0, said: ["poplin: deploying 0.3.1 (was asked for latest)"], ran: RELEASE_COMMANDS, asked: ["latest", "fetch 0.3.1"], left: ["wrangler.jsonc"] },
    },
    {
      name: "a version, older than the newest release",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.2.0" }, latest: { kind: "release", version: "0.3.1" } },
      outcome: { code: 0, said: ["poplin: deploying 0.2.0 (was asked for 0.2.0)"], ran: RELEASE_COMMANDS, asked: ["fetch 0.2.0"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`this`",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "this" }, latest: { kind: "release", version: "0.3.1" } },
      outcome: { code: 0, said: ["poplin: deploying your copy's own files (was asked for this)"], ran: [OWN_FILES], asked: [], left: ["wrangler.jsonc"] },
    },
    {
      name: "no variable, and the source's outright answer that no release is published",
      scene: { env: { WORKERS_CI: "1" }, latest: { kind: "none" } },
      outcome: { code: 0, said: ["poplin: no release is published yet; deploying your copy's own files"], ran: [OWN_FILES], asked: ["latest"], left: ["wrangler.jsonc"] },
    },
    {
      name: "`latest`, and the source's outright answer that no release is published",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" }, latest: { kind: "none" } },
      outcome: { code: 0, said: ["poplin: no release is published yet; deploying your copy's own files"], ran: [OWN_FILES], asked: ["latest"], left: ["wrangler.jsonc"] },
    },
    {
      name: "a release whose own deploy fails",
      scene: { env: { WORKERS_CI: "1" }, latest: { kind: "release", version: "0.3.1" }, failing: "deploy" },
      outcome: { code: 3, said: ["poplin: deploying 0.3.1 (was asked for latest)"], ran: RELEASE_COMMANDS, asked: ["latest", "fetch 0.3.1"], left: ["wrangler.jsonc"] },
    },
  ];

  // Drift: the copy on GitHub never changes, so these commands and the handed-over variable are what every later release is run with.
  test.each(hosted)("in the hosted build, with $name, the deploy says which version and runs exactly these commands, and its scratch folder is gone after", async ({ scene, outcome }) => {
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
      name: "a source that does not say which release is the newest",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "latest" }, latest: { kind: "unknown" } },
      said: ["poplin: github.com did not say which release of poplin is the newest. Nothing was deployed. Build again in a few minutes, or set the build variable POPLIN_VERSION to a version like 0.2.0."],
      asked: ["latest"],
      ran: [],
    },
    {
      name: "a source that does not say, with no variable",
      scene: { env: { WORKERS_CI: "1" } },
      said: ["poplin: github.com did not say which release of poplin is the newest. Nothing was deployed. Build again in a few minutes, or set the build variable POPLIN_VERSION to a version like 0.2.0."],
      asked: ["latest"],
      ran: [],
    },
    {
      name: "a version with no release, while no release is published at all",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.1.0" }, latest: { kind: "none" }, fetched: false },
      said: ["poplin: release 0.1.0 could not be fetched from github.com. Nothing was deployed. Check that 0.1.0 is a release of poplin, then build again."],
      asked: ["fetch 0.1.0"],
      ran: [],
    },
    {
      name: "a release that cannot be fetched",
      scene: { env: { WORKERS_CI: "1", POPLIN_VERSION: "0.9.9" }, fetched: false },
      said: ["poplin: release 0.9.9 could not be fetched from github.com. Nothing was deployed. Check that 0.9.9 is a release of poplin, then build again."],
      asked: ["fetch 0.9.9"],
      ran: [],
    },
    {
      name: "a release whose install fails",
      scene: { env: { WORKERS_CI: "1" }, latest: { kind: "release", version: "0.3.1" }, failing: "install" },
      said: ["poplin: what release 0.3.1 needs could not be installed. Nothing was deployed. Build again in a few minutes."],
      asked: ["latest", "fetch 0.3.1"],
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

  // Drift: old code refuses a newer database, so a build that quietly deployed the copy's own older files after a failed fetch would take the install down.
  test.each(stopped)("in the hosted build, $name fails the build with one line that says what to do, and wrangler never runs on the copy's own files", async ({ scene, said, asked, ran }) => {
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

    expect(await play({ env: { WORKERS_CI: "1", POPLIN_COPY_CONFIG: "<folder>/copy.jsonc", ...env }, latest: { kind: "release", version: "0.3.1" } })).toEqual({ code: 0, said: [], ran: [ran], asked: [], left: ["wrangler.jsonc"] });
  });
});
