// The sample sites of an install that is put back: every site of the demo's own table, published through the CLI as its history leaves it.
//
//   packages/demo/src/preview/world/sample-sites.ts   the table: the demo's seed plays all of it, and this publishes what it ends in
//
//   a site of the table        one publish, with its name, who may open it, its title, and its other settings
//   the site published most    three publishes: its list of versions holds three, as the demo's does
//   a site that ends trashed   moved to the trash
//   the demo's own row         left out: the reset publishes the built demo there
//   a site the install kept    not published again: it is still what its row ends in
//
// Every version of the demo's history of thirty days is far past what a reset may ask of the bucket, so one site alone gets more than one.

import { cpSync } from "node:fs";
import { join } from "node:path";
import { PUBLISHED_SITE } from "@poplin/core/src/actions/publish/finish-publish";
import type { SiteObject } from "@poplin/core/src/actions/sites/site-object";
import type { SettingValues } from "@poplin/core/src/records/settings";
import * as v from "valibot";

import type { Io } from "../../../../cli/src/commands/records";
import { run as runCli } from "../../../../cli/src/commands/run";
import { type RealSites, readRealSites } from "../../../../demo/src/preview/world/real-sites";
import { type Standing, standingSites, THE_DEMO } from "../../../../demo/src/preview/world/sample-sites";
import type { Wanted } from "./same-site";
import type { Stop } from "./util";

/** The most publishes the site that was published most is given: as many versions as an install keeps by default. */
const MOST_PUBLISHES = 3;

/** How long a site must stay for the demo to link to it: until the reset of the next midnight, in milliseconds. */
const DAY_MS = 86_400_000;

/** What a site with no expiry is published with: an install's own default would give it one. */
const NEVER = "never";

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

/** One site of the table as a reset leaves it. */
export interface Sample {
  /** The row as its history ends. */
  readonly row: Standing;

  /** The folder it is published from. */
  readonly folder: string;

  /** How many versions it is given. */
  readonly versions: number;
}

/** What the install holds of the table after the samples were published. */
interface Put {
  /** The names of the sites outside the trash, in the table's order. */
  readonly live: readonly string[];

  /** The names of the sites in the trash. */
  readonly binned: readonly string[];

  /** The site with more than one version, and how many it has. */
  readonly versioned: { readonly name: string; readonly versions: number };

  /** The address of each site outside the trash that stays for a day at least, by its name. */
  readonly real: RealSites;
}

/** A site as a publish or a listing answered it, in what the demo's links read of it. */
type Site = Pick<SiteObject, "url" | "expires" | "updated">;

/** The folder a site is published from: its sample's own, or one put together from its sample and every sample beside it, each under its folder. */
function folderOf(row: Standing, from: Folders): string {
  const beside = Object.entries(row.beside);
  if (beside.length === 0) return join(from.samples, row.sample);

  const folder = join(from.scratch, row.name);
  cpSync(join(from.samples, row.sample), folder, { recursive: true });
  for (const [under, sample] of beside) cpSync(join(from.samples, sample), join(folder, under), { recursive: true });

  return folder;
}

/** The flags that give a new site what its row ends in. A site with no expiry is told so. Whether search engines may list it stays the install's own choice. */
function settingsOf(row: Standing): readonly string[] {
  const { title, embeddable, expires = NEVER } = row.settings;
  const access = row.reach.access === "public" ? ["--public", "--public-name", row.reach.public_name] : [`--${row.reach.access}`];
  const titled = typeof title === "string" ? ["--title", title] : [];
  const framed = embeddable === undefined ? [] : ["--embeddable", embeddable ? "on" : "off"];

  return [...access, ...titled, ...framed, "--expires", expires];
}

/** Publish one folder, and read the site the install answered with. */
async function publish(cli: Cli, target: readonly string[], what: string): Promise<v.InferOutput<typeof PRINTED>["site"] | Stop> {
  cli.said.length = 0;
  const code = await runCli(["publish", ...target, "--json"], cli.io);
  if (code !== 0) return { kind: "failed", what: `publishing ${what} exited ${code}` };

  const printed = v.safeParse(PRINTED, cli.said.at(-1));

  return printed.success ? printed.output.site : { kind: "failed", what: `publishing ${what} printed no site` };
}

/** Publish one site of the table with its versions, and move it to the trash where its row ends there. */
async function publishRow(cli: Cli, { row, folder, versions }: Sample): Promise<Site | Stop> {
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
 * Read the sample table as a reset leaves it: every site but the demo's own row, with its folder and its versions.
 *
 * @returns the sites in the table's order; a site put together from more than one sample has its folder written under `from.scratch`
 */
export function sampleSites(from: Folders): readonly Sample[] {
  const rows = standingSites().filter((row) => row.sample !== THE_DEMO);
  const most = Math.max(...rows.map((row) => row.publishes));
  const longest = rows.find((row) => row.publishes === most);

  return rows.map((row) => ({ row, folder: folderOf(row, from), versions: row === longest ? Math.min(most, MOST_PUBLISHES) : 1 }));
}

/**
 * Say what publishing a sample leaves, for the question whether a site the install holds is still that.
 *
 * @param settings - the install's own: whether search engines may list a new site, which no publish of a sample says, and how many versions of a site it keeps
 */
export function wantedOf({ row, folder, versions }: Sample, settings: Pick<SettingValues, "default_search_engines" | "versions_kept">): Wanted {
  const { title, embeddable = true, expires = NEVER } = row.settings;
  const typed = typeof title === "string" ? title : undefined;
  const kept = { kept: Math.min(versions, settings.versions_kept), newest: versions };

  return { reach: row.reach, title: typed, embeddable, searchEngines: settings.default_search_engines, expires, trashed: row.trashed, versions: kept, folder };
}

/**
 * Publish every site of the sample table the install did not keep. No site of the install may hold the name or the public name of one that is published.
 *
 * @param kept - the sites the install holds that are still what their rows end in, by the row's name
 * @returns what the install holds of the table afterwards, or the first step that failed, in words that quote nothing the install said
 */
export async function publishSamples(cli: Cli, samples: readonly Sample[], kept: ReadonlyMap<string, Site>): Promise<Put | Stop> {
  const longest = samples.reduce((most, sample) => (sample.versions > most.versions ? sample : most));
  const real: Record<string, string> = {};

  for (const sample of samples) {
    const { row } = sample;
    const site = kept.get(row.name) ?? (await publishRow(cli, sample));
    if ("kind" in site) return site;

    const stays = site.expires === NEVER || site.expires - site.updated > DAY_MS;
    // Written as a browser writes it. The demo takes the root of an origin alone: a site that answers under a path, as every site of an install without a domain does, gets no link.
    if (!row.trashed && stays) real[row.name] = new URL(site.url).href;
  }

  const names = (trashed: boolean): readonly string[] => samples.filter(({ row }) => row.trashed === trashed).map(({ row }) => row.name);

  return { live: names(false), binned: names(true), versioned: { name: longest.row.name, versions: longest.versions }, real: readRealSites(real) };
}
