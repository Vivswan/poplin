// The sample sites, one table for everything that shows them: the demo's seed plays the whole of it, and an install that is put back to the samples publishes what it ends in.
//
//   SITES          each site as it is first made: its sample, who may open it, its title
//   SITE_HISTORY   what happened to each since: a new version, a changed setting, the trash and the way back
//   standingSites  what the two come to, which is what a list of the sites shows
//
// Every name is invented.

import { readChanges, type SiteChanges } from "../../../core/src/actions/changes";
import { parseSiteName, type ReservedNames } from "../../../core/src/names/names";
import type { SiteAccess } from "../../../core/src/records/site";

/** The sample of the row that stands for the demo itself. No folder holds it: the demo's seed publishes one page that leads back to the demo, and an install publishes the built demo. */
export const THE_DEMO = "demo";

/** No public name kept back: the table is the same for every address layout, and an install that keeps one of its names refuses it when the table is played. */
const NONE_KEPT: ReservedNames = { has: () => false };

/** Every sample site, by the name it is made under, the oldest first. */
export const SITES: readonly Draft[] = [
  { ago: 31, name: "demo", sample: THE_DEMO, by: "mira", settings: { access: "public", public_name: "demo", title: "poplin demo" } },
  { ago: 30, name: "handbook", sample: "trip-summary", by: "mira", settings: { access: "public", title: "Team handbook" } },
  { ago: 21, name: "sales-report", sample: "sales-report", by: "report agent", settings: { title: "Q3 sales report" } },
  { ago: 15, name: "old-notes", sample: "trip-summary", by: "travel agent", settings: { title: "Notes from the offsite" } },
  { ago: 12, name: "launch-deck", sample: "launch-deck", by: "mira", settings: { access: "unlisted", title: "Launch deck" } },
  { ago: 10, name: "team-site", sample: "checkout-prototype", beside: { deck: "launch-deck", report: "sales-report" }, by: "mira", settings: { title: "Team site" } },
  { ago: 9, name: "lisbon-trip", sample: "trip-summary", by: "travel agent", settings: { access: "public", public_name: "lisbon", title: "Lisbon, four days" } },
  { ago: 6, name: "winter-offer", sample: "checkout-prototype", by: "mira", settings: { access: "unlisted", title: "Winter offer", expires: "30d" } },
  { ago: 5, name: "pricing-draft", sample: "sales-report", by: "report agent", settings: { access: "unlisted", title: "Pricing", embeddable: false } },
  { ago: 4, name: "spring-offer", sample: "checkout-prototype", by: "mira", settings: { access: "unlisted", title: "Spring offer", expires: "7d" } },
  { ago: 2, name: "status-board", sample: "launch-deck", by: "mira", settings: { title: "Status board" } },
  { ago: 0, name: "checkout", sample: "checkout-prototype", by: "mira", settings: { title: "Checkout prototype", expires: "2d" } },
];

/** What happened to the sites since each was made, the oldest moment first. */
export const SITE_HISTORY: readonly SiteMoment[] = [
  { ago: 27.7, does: "version", by: "mira", site: "handbook" },
  { ago: 25.6, does: "version", by: "jonas", site: "handbook" },
  { ago: 22.4, does: "set", by: "jonas", site: "handbook", changes: { search_engines: true } },
  { ago: 20, does: "version", by: "report agent", site: "sales-report" },
  { ago: 19, does: "version", by: "report agent", site: "sales-report" },
  { ago: 18.6, does: "set", by: "jonas", site: "sales-report", changes: { embeddable: false } },
  { ago: 16.4, does: "version", by: "report agent", site: "sales-report" },
  { ago: 14.5, does: "set", by: "mira", site: "old-notes", changes: { access: "unlisted" } },
  { ago: 13.8, does: "version", by: "mira", site: "handbook" },
  { ago: 13.1, does: "version", by: "travel agent", site: "old-notes" },
  { ago: 11.6, does: "link", by: "mira", site: "launch-deck" },
  { ago: 9.7, does: "version", by: "report agent", site: "sales-report" },
  { ago: 8.9, does: "version", by: "mira", site: "launch-deck" },
  { ago: 8.6, does: "version", by: "travel agent", site: "lisbon-trip" },
  { ago: 6.8, does: "version", by: "mira", site: "team-site" },
  { ago: 5.6, does: "version", by: "report agent", site: "sales-report" },
  { ago: 4.6, does: "version", by: "report agent", site: "pricing-draft" },
  { ago: 3.9, does: "set", by: "mira", site: "pricing-draft", changes: { name: "pricing" } },
  { ago: 3.5, does: "version", by: "travel agent", site: "lisbon-trip" },
  { ago: 3.2, does: "set", by: "jonas", site: "spring-offer", changes: { embeddable: false } },
  { ago: 3, does: "trash", by: "mira", site: "old-notes" },
  { ago: 2.7, does: "version", by: "report agent", site: "sales-report" },
  { ago: 2.4, does: "trash", by: "jonas", site: "launch-deck" },
  { ago: 2.3, does: "restore", by: "mira", site: "launch-deck" },
  { ago: 1.5, does: "version", by: "mira", site: "team-site" },
  { ago: 0.7, does: "version", by: "report agent", site: "pricing-draft" },
  { ago: 0.6, does: "version", by: "mira", site: "handbook" },
  { ago: 0.4, does: "version", by: "travel agent", site: "lisbon-trip" },
  { ago: 0.2, does: "version", by: "report agent", site: "sales-report" },
];

/** The settings a row keeps as they were asked: the last value of each. */
const SETTINGS = ["title", "search_engines", "embeddable", "expires"] as const;

/** Who does a thing: one of the two people, or an agent by the note of its token. */
export type Who = "mira" | "jonas" | "report agent" | "travel agent" | "nightly build";

/** One sample site as it is first made. */
export interface Draft {
  /** How many days ago it is made. */
  readonly ago: number;

  /** The name it is made under. */
  readonly name: string;

  /** The sample it is published from: a folder of `demo/samples`, or `THE_DEMO`. */
  readonly sample: string;

  /** The samples it holds beside that one, each under a folder. */
  readonly beside?: Readonly<Record<string, string>>;

  /** Who publishes it. */
  readonly by: Who;

  /** The settings it is made with. */
  readonly settings: SiteChanges;
}

/** What is done to a site, by the name the site was made under, whatever it is called since. */
type Done = { readonly does: "version" | "trash" | "restore" | "link"; readonly site: string } | { readonly does: "set"; readonly site: string; readonly changes: SiteChanges };

/** One moment of a site's history: how many days ago it happens, what is done, and by whom. */
export type SiteMoment = { readonly ago: number; readonly by: Who } & Done;

/** A sample site as its history leaves it. */
export interface Standing {
  /** The name it has now. */
  readonly name: string;

  /** The sample it is published from: a folder of `demo/samples`, or `THE_DEMO`. */
  readonly sample: string;

  /** The samples it holds beside that one, each under a folder. */
  readonly beside: Readonly<Record<string, string>>;

  /** Who may open it, with its public name where it is public. */
  readonly reach: SiteAccess;

  /** The settings it was given beside its name and its access, the last value of each. */
  readonly settings: Pick<SiteChanges, (typeof SETTINGS)[number]>;

  /** How often it was published. An install keeps the newest of these as its versions, as many as its settings say. */
  readonly publishes: number;

  /** Whether it is in the trash. */
  readonly trashed: boolean;
}

/** A draft before anything happened to it: a private site with no settings, asked for the settings it is made with. */
function made(draft: Draft): Standing {
  return changed({ name: draft.name, sample: draft.sample, beside: draft.beside ?? {}, reach: { access: "private" }, settings: {}, publishes: 1, trashed: false }, draft.settings);
}

/** A site after settings were asked of it. The product's own reading of them decides its name, who may open it, and its public name. */
function changed(site: Standing, asked: SiteChanges): Standing {
  const name = parseSiteName(site.name);
  const read = name.ok ? readChanges(asked, { name: name.value, current: site.reach, now: 0, reserved: NONE_KEPT }) : name;
  if (!read.ok) throw new Error(`the sample table asks of ${site.name} what the product refuses`);

  const given = SETTINGS.filter((key) => asked[key] !== undefined).map((key) => [key, asked[key]]);

  return { ...site, name: read.details.name ?? site.name, reach: read.access ?? site.reach, settings: { ...site.settings, ...Object.fromEntries(given) } };
}

/** A site after one moment of its history. A new link changes its address alone, which no row here holds. */
function after(site: Standing, moment: SiteMoment): Standing {
  if (moment.does === "version") return { ...site, publishes: site.publishes + 1 };

  if (moment.does === "set") return changed(site, moment.changes);

  if (moment.does === "link") return site;

  return { ...site, trashed: moment.does === "trash" };
}

/**
 * Work out what the table comes to: every sample site as the last moment of its history leaves it.
 *
 * @returns the sites in the order they were made, the trashed ones among them. An expiry is still the span the table names, counted from whenever the site is made
 */
export function standingSites(): readonly Standing[] {
  const sites = new Map(SITES.map((draft) => [draft.name, made(draft)]));

  for (const moment of SITE_HISTORY) {
    const site = sites.get(moment.site);
    if (site === undefined) throw new Error(`the history of the sample sites names ${moment.site}, which the table does not make`);

    sites.set(moment.site, after(site, moment));
  }

  return [...sites.values()];
}
