// A site as the rest of the code sees it, and the one place a row of the sites table becomes that value.

import * as v from "valibot";

import type { PublicName, SiteName } from "../names/names";
import type { SiteId } from "../sites/ids";
import { COUNT, HOLDER, type Holder, MOMENT, POSITIVE, PUBLIC_NAME, SITE_ID, SITE_NAME } from "./fields";
import { randomText } from "./random-text";

/** The form of a folder key. */
const FOLDER_PATTERN = /^[0-9a-z]{16}$/;

/** Who may open a site: only its admins, anyone with its address, or everyone under its public name too. */
const ACCESSES = ["private", "unlisted", "public"] as const;

/** The key of a site's file folder. */
export const SITE_FOLDER = v.custom<SiteFolder>(isSiteFolder, "a site folder is 16 lowercase base36 characters");

/** A title as shown on the dashboard. */
export const TITLE = v.pipe(v.string(), v.minLength(1));

/** One kept publish, as the versions table holds it. */
const VERSION = v.object({ number: POSITIVE, published_at: MOMENT, published_by: HOLDER, bytes: COUNT, files: COUNT });

/** The kept publishes of one site: at least one, no number twice. */
const VERSIONS = v.pipe(
  v.array(VERSION),
  v.minLength(1),
  v.check((versions) => new Set(versions.map((version) => version.number)).size === versions.length, "each version number is kept once"),
);

/** Who may open a site. A public site names its public name; no other access has one. */
export const SITE_ACCESS = v.variant("access", [
  v.object({ access: v.literal("private") }),
  v.object({ access: v.literal("unlisted") }),
  v.object({ access: v.literal("public"), public_name: PUBLIC_NAME }),
]);

/** What a new site is made from. A public site names its public name; no other access has one. `title` is the typed one, and `page_title` the entry page's own, left out for a page with none. `bytes` and `files` are the size of its first version. */
export const NEW_SITE = v.intersect([
  v.object({
    name: SITE_NAME,
    folder: SITE_FOLDER,
    title: v.nullable(TITLE),
    page_title: v.optional(TITLE),
    search_engines: v.boolean(),
    embeddable: v.optional(v.boolean(), true),
    expires: v.union([v.literal("never"), MOMENT]),
    bytes: COUNT,
    files: COUNT,
  }),
  SITE_ACCESS,
]);

/** The settings of a site that change without touching its access, its id, or its versions; each is optional. */
export const SITE_DETAILS = v.strictObject({
  name: v.optional(SITE_NAME),
  title: v.optional(v.nullable(TITLE)),
  search_engines: v.optional(v.boolean()),
  embeddable: v.optional(v.boolean()),
  expires: v.optional(v.union([v.literal("never"), MOMENT])),
});

/** A row of the sites table with its versions gathered as JSON text. */
const SITE_ROW = v.object({
  id: SITE_ID,
  name: SITE_NAME,
  folder: SITE_FOLDER,
  access: v.picklist(ACCESSES),
  public_name: v.nullable(PUBLIC_NAME),
  title: v.nullable(TITLE),
  page_title: v.nullable(TITLE),
  search_engines: v.picklist([0, 1]),
  embeddable: v.picklist([0, 1]),
  expires_at: v.nullable(MOMENT),
  live_version: POSITIVE,
  owner: HOLDER,
  created_at: MOMENT,
  updated_at: MOMENT,
  trashed_at: v.nullable(MOMENT),
  versions: v.pipe(v.string(), v.parseJson(), VERSIONS),
});

declare const siteFolderBrand: unique symbol;

/** The key of the folder a site's files sit under in the bucket. It is made once and never changes, whatever the site's id becomes. */
export type SiteFolder = string & { readonly [siteFolderBrand]: true };

/** A row of the sites table, its versions read from their JSON text. */
type SiteRow = v.InferOutput<typeof SITE_ROW>;

/** One publish that can still be gone back to. `bytes` is the sum of its files' sizes and `files` their count. Times are milliseconds since the epoch. */
type SiteVersion = v.InferOutput<typeof VERSION>;

/** Who may open a site. Only a public site holds a public name. */
export type SiteAccess = { readonly access: "private" } | { readonly access: "unlisted" } | { readonly access: "public"; readonly public_name: PublicName };

/** Whether a site is served or sits in the trash since `trashed_at`. */
type SiteState = { readonly state: "live" } | { readonly state: "trash"; readonly trashed_at: number };

/**
 * A site.
 *
 * `title` is the title its owner typed, `null` when none was, and `page_title` the title its entry page had when it was last published, `null` for a page with none.
 * A site is shown under the typed title, and under the page's when none is typed. `expires` is `"never"` or the moment the site stops being served. `embeddable` says whether other pages may show the site in a frame.
 *
 * `versions` is in ascending order and holds `live_version`. `owner` is whoever made the site. Times are milliseconds since the epoch.
 */
export type Site = {
  readonly id: SiteId;
  readonly name: SiteName;
  readonly folder: SiteFolder;
  readonly title: string | null;
  readonly page_title: string | null;
  readonly search_engines: boolean;
  readonly embeddable: boolean;
  readonly expires: "never" | number;
  readonly live_version: number;
  readonly versions: readonly SiteVersion[];
  readonly owner: Holder;
  readonly created_at: number;
  readonly updated_at: number;
} & SiteAccess &
  SiteState;

function isSiteFolder(value: unknown): boolean {
  return typeof value === "string" && FOLDER_PATTERN.test(value);
}

function accessOf(row: SiteRow): SiteAccess {
  if (row.access === "public" && row.public_name !== null) return { access: "public", public_name: row.public_name };

  if (row.access !== "public" && row.public_name === null) return { access: row.access };

  throw new Error(`site ${row.id} is stored as ${row.access} ${row.public_name === null ? "without" : "with"} a public name`);
}

/**
 * Make the folder key of a new site.
 *
 * @returns 16 base36 characters, about 82 bits, each as likely as any other; a site's files are stored under it
 */
export function mintSiteFolder(): SiteFolder {
  return randomText("site-folder") as SiteFolder;
}

/**
 * Turn a row of the sites table into a site.
 *
 * @param row - the columns of the row, with `versions` as JSON text
 * @returns the site, its versions in ascending order
 * @throws {Error} the row is no site: a column breaks its rule, the access and the public name disagree, or the live version is not kept
 */
export function siteFromRow(row: unknown): Site {
  const parsed = v.safeParse(SITE_ROW, row);
  if (!parsed.success) throw new Error(`a stored site is not a site: ${v.summarize(parsed.issues)}`);

  const { access, public_name, search_engines, embeddable, expires_at, trashed_at, versions, ...rest } = parsed.output;
  const kept = [...versions].sort((left, right) => left.number - right.number);
  if (!kept.some((version) => version.number === rest.live_version))
    throw new Error(`site ${rest.id} is live at version ${rest.live_version}, which is not kept`);

  const state: SiteState = trashed_at === null ? { state: "live" } : { state: "trash", trashed_at };

  return {
    ...rest,
    search_engines: search_engines === 1,
    embeddable: embeddable === 1,
    expires: expires_at ?? "never",
    versions: kept,
    ...accessOf(parsed.output),
    ...state,
  };
}

/**
 * Turn a site that arrives from outside the database into the columns it is stored in.
 *
 * @returns the columns of the sites table, with the versions as a list in ascending order
 * @throws {Error} the value is no site, by the rules of `siteFromRow`
 */
export function siteToRow(site: Site): SiteRow {
  // A row holds the trash as a moment alone, so a trashed site without one would be stored as a live site.
  if (site.state === "trash" && !v.is(MOMENT, site.trashed_at)) throw new Error(`site ${site.id} is in the trash since no moment`);

  const columns: Omit<SiteRow, "versions"> = {
    id: site.id,
    name: site.name,
    folder: site.folder,
    access: site.access,
    public_name: site.access === "public" ? site.public_name : null,
    title: site.title,
    page_title: site.page_title,
    search_engines: site.search_engines ? 1 : 0,
    embeddable: site.embeddable ? 1 : 0,
    expires_at: site.expires === "never" ? null : site.expires,
    live_version: site.live_version,
    owner: site.owner,
    created_at: site.created_at,
    updated_at: site.updated_at,
    trashed_at: site.state === "trash" ? site.trashed_at : null,
  };
  const checked = siteFromRow({ ...columns, versions: JSON.stringify(site.versions) });

  return { ...columns, versions: [...checked.versions] };
}
