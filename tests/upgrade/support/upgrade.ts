// The upgrade check: an install made and filled by one tree's code, then every shape that outlives a release handed to this code.
//
//   database, settings, storage, update notice   the install is opened in place by this code
//   backup                                       a zip one code exports, the other imports
//   login file                                   saved by that code's command, read by this one
//   the two commands                             each code's command against the other's install
//   module                                       the names an install's variables file and state hold

import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fault, field, type Machine, type Ran, runCli } from "./command";
import { attempt, type Finding, found } from "./findings";
import { capture, upgradeInPlace } from "./in-place";
import { moduleFaults } from "./module-names";
import { type Seeded, seedInstall } from "./seeded-install";
import { newInstall } from "./this-install";
import { HERE, part, type Tree } from "./trees";
import { type Listening, listen } from "./util";
import { walk } from "./walk";

/** Where a tree's command saves a login: the module from its root, and the export. */
const SAVE_LOGIN = ["packages/cli/src/local/login-file.ts", "saveLogin"] as const;

/** The small site the check publishes. */
const SITE: Readonly<Record<string, string>> = {
  "index.html": '<!doctype html><title>A walk</title><link rel="stylesheet" href="site.css"><p>One page.</p>\n',
  "site.css": "p { margin: 0 }\n",
};

/** What a backup carries of a site, as a listing shows it. */
const CARRIED = ["name", "access", "public_name", "state", "live_version", "versions", "bytes", "files"] as const;

/** How a tree's command saves a login. */
type SaveLogin = (
  login: { readonly server: string; readonly token: string },
  machine: { readonly env: Readonly<Record<string, string>>; readonly platform: string; readonly home: string },
) => Promise<void>;

/** Two installs side by side, and the machine that asks them. */
interface Scene {
  /** The tree being upgraded from. */
  readonly from: Tree;

  /** The folder that stands for the home of the person running commands. */
  readonly home: string;

  /** The folder of the small site. */
  readonly folder: string;

  /** The install `from` made and filled. */
  readonly seeded: Seeded;

  /** The machine as it asks that install. */
  readonly there: Machine & { readonly login: { readonly server: string } };

  /** The machine as it asks a new install of this code. */
  readonly here: Machine & { readonly login: { readonly server: string; readonly token: string } };
}

function firstLine(ran: Ran): string {
  return ran.said.split("\n")[0] ?? "";
}

/** The ids of the sites an answer lists. */
function idsOf(answer: unknown): string[] {
  const sites = field(answer, "sites");

  return Array.isArray(sites) ? sites.map((site) => String(field(site, "id"))) : [];
}

/** Every site an install holds, in the trash or out of it, by its id. Throws when the install does not list them. */
async function held(cli: Tree, machine: Machine): Promise<Map<string, unknown>> {
  const [live, trashed] = [await runCli(cli, machine, ["list"]), await runCli(cli, machine, ["list", "--trash"])];
  const sites = [live, trashed].flatMap((ran): unknown[] => {
    const listed = field(ran.answer, "sites");
    if (ran.exit !== 0 || !Array.isArray(listed)) throw new Error(`\`${ran.line}\` listed no sites: ${firstLine(ran)}`);

    return listed;
  });

  return new Map(sites.map((site) => [String(field(site, "id")), site]));
}

/** A login file that code's command saved, read by this code's command. */
async function loginFaults(scene: Scene): Promise<string[]> {
  const saveLogin = await part<SaveLogin>(scene.from, ...SAVE_LOGIN);
  const home = join(scene.home, "saved");
  await saveLogin(scene.here.login, { env: { POPLIN_CONFIG_DIR: join(home, "config") }, platform: process.platform, home });
  const ran = await runCli(HERE, { home }, ["whoami"]);
  if (ran.exit === 0 && field(ran.answer, "server") === scene.here.login.server) return [];

  return [`this code's command does not read the login file ${scene.from.name} saved: ${firstLine(ran)}`];
}

/** What an import left of the sites a backup was made of: a line per site that is not there, and per site that came back as another. */
function lost(sites: ReadonlyMap<string, unknown>, backedUp: readonly string[], now: ReadonlyMap<string, unknown>): string[] {
  return backedUp.flatMap((id) => {
    const [was, is] = [sites.get(id), now.get(id)];
    if (is === undefined) return [`the site ${id} is not there`];

    const kept = CARRIED.filter((key) => JSON.stringify(field(was, key)) !== JSON.stringify(field(is, key)));

    return kept.map((key) => `the site ${id} had ${key} ${JSON.stringify(field(was, key))} and has ${JSON.stringify(field(is, key))}`);
  });
}

/** A backup of this code, imported by that code's command into its own install: all of it, or none of it with a refusal. */
async function olderImport(scene: Scene, zip: string, sites: readonly string[]): Promise<string[]> {
  const [before, source] = [await held(scene.from, scene.there), await held(HERE, scene.here)];
  const ran = await runCli(scene.from, scene.there, ["import", zip]);
  const after = await held(scene.from, scene.there);
  if (ran.exit === 0) return lost(source, sites, after).map((line) => `${scene.from.name} said it imported this code's backup, and ${line}`);

  if (ran.answer === undefined) return [`${scene.from.name} failed on this code's backup with no refusal: ${firstLine(ran)}`];

  return after.size === before.size ? [] : [`${scene.from.name} refused this code's backup and kept ${after.size - before.size} of its sites: half an import`];
}

/** A backup each code exports, imported by the other. */
async function backupFaults(scene: Scene): Promise<string[]> {
  const [theirs, ours] = [join(scene.home, "that.zip"), join(scene.home, "this.zip")];
  const kept = await runCli(HERE, scene.here, ["publish", scene.folder, "--name", "kept"]);
  const [exported, made] = [
    await runCli(scene.from, scene.there, ["export", "--all-versions", "--out", theirs]),
    await runCli(HERE, scene.here, ["export", "--all-versions", "--out", ours]),
  ];
  const stuck = [kept, exported, made].find((ran) => ran.exit !== 0);
  if (stuck !== undefined) return [`\`${stuck.line}\` failed against the install of its own code: ${firstLine(stuck)}`];

  const older = await olderImport(scene, ours, idsOf(made.answer));
  const source = await held(scene.from, scene.there);
  const imported = await runCli(HERE, scene.here, ["import", theirs]);
  if (imported.exit !== 0)
    return [...older, fault(imported) ?? `this code refuses the backup of ${scene.from.name} and asks for an update, and it is the newer of the two`];

  const missing = lost(source, idsOf(exported.answer), await held(HERE, scene.here));
  const settings = fault(await runCli(HERE, scene.here, ["import", theirs, "--settings"]));

  return [
    ...older,
    ...missing.map((line) => `this code imported the backup of ${scene.from.name}, and ${line}`),
    ...(settings === undefined ? [] : [`this code does not take the settings of the backup of ${scene.from.name}: ${settings}`]),
  ];
}

/** Each code's command against the other's install, and that code's command against its own, which the walk must fit. */
async function wire(scene: Scene): Promise<{ readonly findings: Finding[]; readonly site: string | undefined }> {
  const both = [scene.from, HERE];
  const own = await walk({ cli: scene.from, machine: scene.there, folder: scene.folder, both: [scene.from] }, "walk-own");
  // The two walk two installs, so neither waits for the other.
  const [ahead, behind] = await Promise.all([
    walk({ cli: HERE, machine: scene.there, folder: scene.folder, both }, "walk-ahead"),
    walk({ cli: scene.from, machine: scene.here, folder: scene.folder, both }, "walk-behind"),
  ]);

  return {
    site: own.site,
    findings: [
      ...found(
        "that command on this install",
        own.faults.map((line) => `even against its own install: ${line}`),
      ),
      ...found("this command on that install", ahead.faults),
      ...found("that command on this install", behind.faults),
    ],
  };
}

/** Every finding of one scene. The install `from` made stops answering before this code opens it. */
async function findingsOf(scene: Scene, listening: Listening, fresh: Awaited<ReturnType<typeof newInstall>>): Promise<Finding[]> {
  const walked = await wire(scene);
  const login = await attempt("login file", "saving and reading a login", () => loginFaults(scene));
  const backup = await attempt("backup", "exporting and importing", () => backupFaults(scene));
  const before = await capture({ from: scene.from, seeded: scene.seeded, machine: scene.there, folder: scene.folder });
  await listening.stop();
  const inPlace = await upgradeInPlace({ from: scene.from, seeded: scene.seeded, machine: scene.there, folder: scene.folder }, before, walked.site, fresh);

  return [...inPlace, ...backup, ...login, ...walked.findings, ...found("module", moduleFaults(scene.from, HERE))];
}

/**
 * Make an install with a tree's code, fill it, and hand everything that outlives a release to this checkout's code.
 *
 * @param from - the code being upgraded from: the last release, or any other tree
 * @returns one finding per thing this code does not take as that code left or sends it; none when the upgrade works
 * @throws {Error} the tree's own code could not make, fill, or read its install: the check itself does not fit that tree
 */
export async function upgradeFindings(from: Tree): Promise<readonly Finding[]> {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-upgrade-"));
  const folder = join(scratch.path, "site");
  mkdirSync(folder);
  for (const [file, text] of Object.entries(SITE)) writeFileSync(join(folder, file), text);

  const seeded = await seedInstall(from);
  const fresh = await newInstall();
  await using listeners = new AsyncDisposableStack();
  const there = listen(seeded.fetch);
  listeners.defer(there.stop);
  const here = listen(fresh.api);
  listeners.defer(here.stop);

  return await findingsOf(
    {
      from,
      home: scratch.path,
      folder,
      seeded,
      there: { home: scratch.path, login: { server: there.origin, token: seeded.token } },
      here: { home: scratch.path, login: { server: here.origin, token: fresh.token } },
    },
    there,
    fresh,
  );
}
