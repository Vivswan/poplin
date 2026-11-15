// The statements that read and change sites and their kept versions, and the conditions a listing of sites is narrowed and ordered by.

import { and, eq, exists, gt, isNotNull, isNull, ne, notExists, or, type SQL, sql as fragment } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import type { PublicName } from "../names/names";
import { SITE_ID, SITE_NAME } from "../records/fields";
import { type NEW_SITE, type SiteAccess, type SiteFolder, TITLE } from "../records/site";
import type { SiteId } from "../sites/ids";
import type { UploadId } from "../records/upload";
import type { Signed, SiteDetails, SitesQuery } from "./database";
import type { Statement } from "./driver";
import { earlierIds, sites, uploads, versions } from "./schema";
import { BUILD, CHANGED, ONE, built, insertFrom, qualified } from "./statements";

/** The columns a version is written with. */
export const VERSION_COLUMNS = [versions.folder, versions.number, versions.published_at, versions.published_by, versions.bytes, versions.files, versions.missing_page, versions.bare_files];

/** The `versions` table as `k`, for the kept versions inside a subquery on `v`. */
export const A_KEPT_VERSION = alias(versions, "k");

/** The `sites` table under a second name, for a statement that asks about the other sites. */
export const OTHER = alias(sites, "other");

/** A site with its kept versions gathered into one JSON column, so one statement gives the whole site. */
export const SITE_FIELDS = {
  id: sites.id,
  name: sites.name,
  folder: sites.folder,
  access: sites.access,
  public_name: sites.public_name,
  title: sites.title,
  page_title: sites.page_title,
  search_engines: sites.search_engines,
  embeddable: sites.embeddable,
  expires_at: sites.expires_at,
  live_version: sites.live_version,
  owner: sites.owner,
  created_at: sites.created_at,
  updated_at: sites.updated_at,
  trashed_at: sites.trashed_at,
  versions: versionsOfSite().as("versions"),
};

/** A site as a listing reads it: with the key a listing by title goes by. */
export const LISTED_FIELDS = { ...SITE_FIELDS, title_key: sites.title_key };

/** What a listing by title goes by, as the `title_key` column of a row holds it. */
export const TITLE_KEY = v.object({ title_key: v.string() });

/** The id, the name and the listed title of a site, as `getSiteNames` reads them. */
export const NAMED_SITE = v.object({ id: SITE_ID, name: SITE_NAME, title: v.nullable(TITLE) });

/** What `getSiteNames` reads of a site: its title is the typed one, else its page's own. */
export const NAMED_FIELDS = { id: sites.id, name: sites.name, title: fragment<string | null>`coalesce(${sites.title}, ${sites.page_title})`.as("title") };

/** The site an earlier id belonged to, as `getLaterSites` reads it. */
export const LATER_SITE = v.object({ earlier: SITE_ID, ...NAMED_SITE.entries });

/** What `getLaterSites` reads: the id asked for, and the site that keeps its folder. */
export const LATER_FIELDS = { earlier: fragment<string>`${qualified(earlierIds.id)}`.as("earlier"), ...NAMED_FIELDS };

/** The place of each access in a listing sorted by access, as the `access_rank` column of a site holds it: from the most private to the most open. */
const ACCESS_RANKS = { private: 0, unlisted: 1, public: 2 } as const;

/** The direction a listing takes when none is asked: the last change first, a name, an access and a title from the start. */
export const DEFAULT_DIRECTIONS = { updated: "desc", name: "asc", access: "asc", title: "asc" } as const;

/**
 * A site whose name holds a text, or whose title does: the typed one, else the page's own, which is the one a listing shows.
 * The text is looked for as it stands, with no sign read as a pattern. Only the letters A to Z match either case: the engine's `lower` changes no other.
 */
export function holding(text: string): SQL {
  return fragment`(instr(${sites.name}, lower(${text})) > 0 OR instr(lower(coalesce(${sites.title}, ${sites.page_title})), lower(${text})) > 0)`;
}

/** The conditions that narrow a listing to what its query asks for: the trash or not, and each filter given. */
export function narrowing(query: SitesQuery): SQL[] {
  const conditions: SQL[] = [eq(sites.trashed, query.trash ? 1 : 0)];

  if (query.owner !== undefined) conditions.push(eq(sites.owner, query.owner));

  if (query.named !== undefined) conditions.push(holding(query.named));

  if (query.access !== undefined) conditions.push(eq(sites.access, query.access));

  if (query.expires !== undefined) conditions.push(query.expires === "set" ? isNotNull(sites.expires_at) : isNull(sites.expires_at));

  return conditions;
}

/**
 * The kept versions of the site a statement selects, gathered into one JSON value.
 *
 * @param withContents - whether each carries what it holds, as serving reads it: whether it has a `404.html`, and of the live one its files without an extension. It costs no row more
 */
export function versionsOfSite(withContents = false): SQL<string> {
  const kept = [versions.number, versions.published_at, versions.published_by, versions.bytes, versions.files];
  const pairs = kept.map((column) => fragment`${fragment.raw(`'${column.name}'`)}, ${qualified(column)}`);
  const bareOfLive = fragment`CASE WHEN ${qualified(versions.number)} = ${qualified(sites.live_version)} THEN ${qualified(versions.bare_files)} END`;
  if (withContents) pairs.push(fragment`'missing_page', ${qualified(versions.missing_page)}`, fragment`'bare_files', ${bareOfLive}`);

  const version = fragment`json_object(${fragment.join(pairs, fragment`, `)})`;

  return fragment<string>`(SELECT json_group_array(${version}) FROM ${versions} WHERE ${qualified(versions.folder)} = ${qualified(sites.folder)})`;
}

/** The sites a condition holds for, each with its kept versions. */
export function sitesWhere(condition: SQL | undefined): Statement {
  return built(BUILD.select(SITE_FIELDS).from(sites).where(condition));
}

/** The site with the given id, with its kept versions. */
export function siteById(id: SiteId): Statement {
  return sitesWhere(eq(sites.id, id));
}

/** Added to a lookup by address: the site is outside the trash and not past its expiry at `now`. */
export function isServed(now: number): SQL | undefined {
  return and(eq(sites.trashed, 0), or(isNull(sites.expires_at), gt(sites.expires_at, now)));
}

/** A new access for a live site, only when it differs and the public name asked for is free: no other site has it as its public name, and no site as its id. */
export function setAccess(id: SiteId, access: SiteAccess["access"], publicName: PublicName | null): Statement {
  const heldByAnother = (name: PublicName): SQL | undefined => and(eq(OTHER.public_name, name), ne(OTHER.id, id));
  const isFree = (name: PublicName): SQL | undefined =>
    and(notExists(BUILD.select(ONE).from(OTHER).where(heldByAnother(name))), notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.id, name))));
  const differs = or(ne(sites.access, access), fragment`${sites.public_name} IS NOT ${publicName}`);
  const live = and(eq(sites.id, id), eq(sites.trashed, 0), differs, publicName === null ? undefined : isFree(publicName));

  return built(BUILD.update(sites).set({ access, public_name: publicName }).where(live));
}

/** The id a site just gave up, kept with the folder of the site now at `next`; written only when the statement before it changed a row. An id kept once before goes to the site that held it last. */
export function keepEarlierId(id: SiteId, next: SiteId): Statement {
  const kept = BUILD.select({ id: fragment<string>`${id}`.as("id"), folder: sites.folder }).from(sites).where(and(eq(sites.id, next), CHANGED));

  return built(BUILD.insert(earlierIds).select(kept).onConflictDoUpdate({ target: earlierIds.id, set: { folder: fragment`excluded.folder` } }));
}

/** The details given, as the columns of `sites` store them. */
export function storedDetails(given: SiteDetails): Partial<Pick<typeof sites.$inferInsert, "name" | "title" | "search_engines" | "embeddable" | "expires_at">> {
  return {
    ...(given.name === undefined ? {} : { name: given.name }),
    ...(given.title === undefined ? {} : { title: given.title }),
    ...(given.search_engines === undefined ? {} : { search_engines: given.search_engines ? 1 : 0 }),
    ...(given.embeddable === undefined ? {} : { embeddable: given.embeddable ? 1 : 0 }),
    ...(given.expires === undefined ? {} : { expires_at: given.expires === "never" ? null : given.expires }),
  };
}

/** Whether no site has a name as its id, and none as its public name. */
export function isFree(name: string): SQL | undefined {
  return and(notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.id, name))), notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.public_name, name))));
}

/** A new site, only while its id and its public name are free, and its upload, when it has one, is pending as the first version of its folder. Its owner is whoever began that upload, or `signed.by`. */
export function insertSite(id: SiteId, site: v.InferOutput<typeof NEW_SITE>, signed: Signed, upload: UploadId | undefined): Statement {
  const publicName = publicNameOf(site);
  const columns = [
    sites.id,
    sites.name,
    sites.folder,
    sites.access,
    sites.public_name,
    sites.title,
    sites.search_engines,
    sites.expires_at,
    sites.live_version,
    sites.next_version,
    sites.owner,
    sites.created_at,
    sites.updated_at,
    sites.embeddable,
    sites.page_title,
  ];
  const owner = fragment`COALESCE((SELECT ${uploads.owner} FROM ${uploads} WHERE ${uploads.id} = ${upload ?? null}), ${signed.by})`;
  const expires = site.expires === "never" ? null : site.expires;
  const identity = fragment`${id}, ${site.name}, ${site.folder}, ${site.access}, ${publicName}, ${site.title}, ${site.search_engines ? 1 : 0}, ${expires}`;
  const values = fragment`${identity}, 1, 2, ${owner}, ${signed.at}, ${signed.at}, ${site.embeddable ? 1 : 0}, ${site.page_title ?? null}`;
  const conditions = and(isFree(id), publicNameIsFree(publicName, id), upload === undefined ? undefined : isFirstPending(upload, site.folder));

  return insertFrom(sites, columns, fragment`SELECT ${values} WHERE ${conditions}`);
}

/** Whether a public name, when one is asked, is not the site's own id and is free. */
export function publicNameIsFree(publicName: PublicName | null, id: SiteId): SQL | undefined {
  return publicName === null ? undefined : and(fragment`${publicName} <> ${id}`, isFree(publicName));
}

/** Whether an upload is pending as the first version of a folder. */
export function isFirstPending(upload: UploadId, folder: SiteFolder): SQL {
  return exists(BUILD.select(ONE).from(uploads).where(and(eq(uploads.id, upload), eq(uploads.state, "pending"), eq(uploads.folder, folder), eq(uploads.number, 1))));
}

/** A kept version of a site, as a subquery of a statement on `sites` asks for it. */
function keptVersion(condition: SQL): SQL {
  return fragment`FROM ${versions} WHERE ${versions.folder} = ${sites.folder} AND ${condition}`;
}

/** The kept version a move of the live version goes to: the number given, or the highest below the live one. */
export function moveLive(id: SiteId, target: number | "previous", at: number): Statement {
  const live = and(eq(sites.id, id), eq(sites.trashed, 0));

  if (target === "previous") {
    const below = keptVersion(fragment`${versions.number} < ${sites.live_version}`);
    const previous = fragment<number>`(SELECT MAX(${versions.number}) ${below})`;

    return built(BUILD.update(sites).set({ live_version: previous, updated_at: at }).where(and(live, fragment`EXISTS (SELECT 1 ${below})`)));
  }

  const kept = fragment`EXISTS (SELECT 1 ${keptVersion(fragment`${versions.number} = ${target}`)})`;

  return built(BUILD.update(sites).set({ live_version: target, updated_at: at }).where(and(live, ne(sites.live_version, target), kept)));
}

/** The versions under a folder beyond the `keep` highest dropped, only after a publish. */
export function dropOldVersions(folder: SQL, keep: number): Statement {
  const highest = fragment`(SELECT ${versions.number} FROM ${versions} WHERE ${versions.folder} = ${folder} ORDER BY ${versions.number} DESC LIMIT ${keep})`;

  return built(BUILD.delete(versions).where(fragment`${CHANGED} AND ${versions.folder} = ${folder} AND ${versions.number} NOT IN ${highest}`));
}

/** A cursor carries what its listing goes by: a listing by name the last site's name, one by access its access, one by title the title it stands under. */
export function requireCursor(query: SitesQuery): void {
  const { after, sort } = query;
  if (after === undefined || sort === undefined || sort === "updated") return;

  if (after[sort] === undefined) throw new RangeError(`a page after another of a listing by ${sort} names the ${sort} of that page's last site`);
}

/** What a cursor holds of the column its listing goes by; `requireCursor` has seen that it holds it. */
export function cursorPlace(after: NonNullable<SitesQuery["after"]>, sort: NonNullable<SitesQuery["sort"]>): string | number {
  return { updated: after.updated_at, name: after.name ?? "", access: ACCESS_RANKS[after.access ?? "private"], title: after.title ?? "" }[sort];
}

/** The public name an access carries, as the `public_name` column stores it: none for a site that is not public. */
export function publicNameOf(access: SiteAccess): PublicName | null {
  return access.access === "public" ? access.public_name : null;
}
