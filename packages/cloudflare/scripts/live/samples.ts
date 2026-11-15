// The sample sites of an install that is put back: every site of the demo's own table, published through the CLI as its history leaves it.
//
//   packages/demo/src/preview/sample-sites.ts   the table: the demo's seed plays all of it, and this publishes what it ends in
//
//   a site of the table        one publish, with its name, who may open it, its title, and its other settings
//   the site published most    three publishes: its list of versions holds three, as the demo's does
//   a site that ends trashed   moved to the trash
//   a site of the seed alone   left out, and so is the row that stands for the demo itself, which the reset publishes
//
// Every version of the demo's history of thirty days is far past what a reset may ask of the bucket, so one site alone gets more than one.

import { cpSync } from "node:fs";
import { join } from "node:path";
import { PUBLISHED_SITE } from "@poplin/core/src/actions/finish-publish";
import * as v from "valibot";

import type { Io } from "../../../cli/src/commands/records";
import { run as runCli } from "../../../cli/src/commands/run";
import type { RealSites } from "../../../demo/src/preview/real-sites";
import { type Standing, standingSites, THE_DEMO } from "../../../demo/src/preview/sample-sites";
import type { Stop } from "./util";

/** The most publishes the site that was published most is given: as many versions as an install keeps by default. */
const MOST_PUBLISHES = 3;

/** How long a site must stay for the demo to link to it: until the reset of the next midnight, in milliseconds. */
const DAY_MS = 86_400_000;

/** What `publish --json` prints on its one line of stdout. */
const PRINTED = v.pipe(v.string(), v.parseJson(), PUBLISHED_SITE);

/** The CLI as a reset runs it: its ends, and the lines it printed on stdout, which this empties before each publish. */
export interface Cli {
  readonly io: Io;
  readonly said: string[];
}

/** Where the files of the sample sites are. */
interface Folders {
  /** The folder that holds one folder per sample. */
  readonly samples: string;

  /** An empty folder of the reset's own, for a site put together from more than one sample. */
  readonly scratch: string;
}

/** What publishing the table left on the install. */
interface Put {
  /** The names of the sites outside the trash, in the table's order. */
  readonly published: readonly string[];

  /** The names of the sites in the trash. */
  readonly binned: readonly string[];

  /** The site with more than one version, and how many it has. */
  readonly versioned: { readonly name: string; readonly versions: number };

  /** The address of each site outside the trash that stays for a day at least, by its name. */
  readonly real: RealSites;
}

/** A site as a publish answered it. */
type Site = v.InferOutput<typeof PRINTED>["site"];

/** The folder a site is published from: its sample's own, or one put together from its sample and every sample beside it, each under its folder. */
function folderOf(row: Standing, from: Folders): string {
  const beside = Object.entries(row.beside);
  if (beside.length === 0) return join(from.samples, row.sample);

  const folder = join(from.scratch, row.name);
  cpSync(join(from.samples, row.sample), folder, { recursive: true });
  for (const [under, sample] of beside) cpSync(join(from.samples, sample), join(folder, under), { recursive: true });

  return folder;
}

/** The flags that give a new site what its row ends in. A site with no expiry is told so: an install's own default would give it one. Whether search engines may list it stays the install's own choice. */
function settingsOf(row: Standing): readonly string[] {
  const { title, embeddable, expires = "never" } = row.settings;
  const access = row.reach.access === "public" ? ["--public", "--public-name", row.reach.public_name] : [`--${row.reach.access}`];
  const titled = typeof title === "string" ? ["--title", title] : [];
  const framed = embeddable === undefined ? [] : ["--embeddable", embeddable ? "on" : "off"];

  return [...access, ...titled, ...framed, "--expires", expires];
}

/** Publish one folder, and read the site the install answered with. */
async function publish(cli: Cli, target: readonly string[], what: string): Promise<Site | Stop> {
  cli.said.length = 0;
  const code = await runCli(["publish", ...target, "--json"], cli.io);
  if (code !== 0) return { kind: "failed", what: `publishing ${what} exited ${code}` };

  const printed = v.safeParse(PRINTED, cli.said.at(-1));

  return printed.success ? printed.output.site : { kind: "failed", what: `publishing ${what} printed no site` };
}

/** Publish one site of the table with so many versions, and move it to the trash where its row ends there. */
async function publishRow(cli: Cli, row: Standing, folder: string, versions: number): Promise<Site | Stop> {
  const made = await publish(cli, [folder, "--name", row.name, ...settingsOf(row)], `the sample ${row.name}`);
  if ("kind" in made) return made;

  for (let version = 2; version <= versions; version += 1) {
    const again = await publish(cli, [folder, "--site", made.label], `version ${version} of the sample ${row.name}`);
    if ("kind" in again) return again;
  }

  if (!row.trashed) return made;

  const code = await runCli(["delete", made.label, "--json"], cli.io);

  return code === 0 ? made : { kind: "failed", what: `moving the sample ${row.name} to the trash exited ${code}` };
}

/**
 * Publish every site of the sample table onto an install that holds none of them.
 *
 * @returns what the install holds of the table afterwards, or the first step that failed, in words that quote nothing the install said
 */
export async function publishSamples(cli: Cli, from: Folders): Promise<Put | Stop> {
  const rows = standingSites().filter((row) => row.only === undefined && row.sample !== THE_DEMO);
  const most = Math.max(...rows.map((row) => row.publishes));
  const longest = rows.find((row) => row.publishes === most);
  const versioned = { name: longest?.name ?? "", versions: Math.min(most, MOST_PUBLISHES) };
  const real: Record<string, string> = {};

  for (const row of rows) {
    const made = await publishRow(cli, row, folderOf(row, from), row === longest ? versioned.versions : 1);
    if ("kind" in made) return made;

    const stays = made.expires === "never" || made.expires - made.updated > DAY_MS;
    // The address is written as a browser writes the root of its origin, which is the one form the demo takes.
    if (!row.trashed && stays) real[row.name] = new URL("/", made.url).href;
  }

  const names = (trashed: boolean): readonly string[] => rows.filter((row) => row.trashed === trashed).map((row) => row.name);

  return { published: names(false), binned: names(true), versioned, real };
}
