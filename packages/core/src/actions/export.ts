// Export: what a backup is made from, read by an admin a page at a time. Nothing changes, and no token, signing key, or audit entry is read.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { COUNT, POSITIVE, SITE_ID, SITE_NAME } from "../records/fields";
import { settingsToText } from "../records/settings";
import type { Site } from "../records/site";
import { type ListCursor, MAX_LIST_LIMIT } from "../storage/storage";
import { fileKey, versionPrefix } from "./files";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";

/** The number of the backup format this code writes, and the highest it reads. */
export const BACKUP_FORMAT = 1;

/** The most sites one page holds, and how many a page holds when no limit is asked. */
const MAX_PAGE = 100;

/** Whether a site comes with every version it keeps, or with its live one alone. */
const ALL_VERSIONS = v.optional(v.boolean(), false);

/** What a page of sites may ask for. */
export const EXPORT_QUERY = v.strictObject({
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_PAGE)), MAX_PAGE),
  after: v.optional(SITE_ID),
  all_versions: ALL_VERSIONS,
});

/** What the export of one site may ask for. */
export const EXPORT_SITE_QUERY = v.strictObject({ all_versions: ALL_VERSIONS });

/** What a page of one version's files may ask for. */
export const EXPORT_FILES_QUERY = v.strictObject({
  version: POSITIVE,
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_LIST_LIMIT)), MAX_LIST_LIMIT),
  cursor: v.optional(v.string()),
});

/** What names one stored file of one version. */
export const EXPORT_FILE_QUERY = v.strictObject({ version: POSITIVE, path: v.string() });

/** A site as a backup holds it, by the keys a client reads: what names it, and what each version it carries holds. Every other key is checked by the install that imports it. */
const STORED_SITE = v.object({ id: SITE_ID, name: SITE_NAME, live_version: POSITIVE, versions: v.pipe(v.array(v.object({ number: POSITIVE, files: COUNT, bytes: COUNT })), v.readonly()) });

/** What the export of the settings answers: every setting in the text form it is typed in, under the backup's format number. */
export const EXPORTED_SETTINGS = v.object({ format: v.number(), settings: v.record(v.string(), v.string()) });

/** What a page of exported sites answers, by the keys a client reads of each site. */
export const EXPORTED_SITES = v.object({ format: v.number(), sites: v.pipe(v.array(STORED_SITE), v.readonly()), next: v.optional(SITE_ID) });

/** What the export of one site answers, by the keys a client reads of the site. */
export const EXPORTED_SITE = v.object({ format: v.number(), site: STORED_SITE });

/** What a page of one version's files answers: each file's path and length, and what `cursor` takes to get the following page. */
export const EXPORTED_FILES = v.object({ files: v.pipe(v.array(v.object({ path: v.string(), size: COUNT })), v.readonly()), next: v.optional(v.string()) });

/** Each member of a union without one key, so a field only some members have stays with them. */
type Without<Value, Key extends PropertyKey> = Value extends unknown ? Omit<Value, Key> : never;

/** A site as a backup holds it: everything the site is stored with but the folder its files sit under, which an import makes anew. */
export type ExportedSite = Without<Site, "folder">;

/** The codes any export of one site may be refused with. */
type SiteCode = "not_allowed" | "not_set_up" | "bad_argument" | "not_found";

/** One page of sites as they are stored, in ascending order of id. `next` is what `after` takes to get the following page, and is absent on the last. */
interface ExportedSites {
  readonly ok: true;
  readonly format: typeof BACKUP_FORMAT;
  readonly sites: readonly ExportedSite[];
  readonly next?: Site["id"];
}

/** One page of the files a version holds, in the store's order. `next` is what `cursor` takes to get the following page, and is absent on the last. */
type ExportedFiles = { readonly ok: true } & Readonly<v.InferOutput<typeof EXPORTED_FILES>>;

/** One stored file: its length in bytes, the media type it is served with, and its bytes, which are read once. */
interface ExportedFile {
  readonly ok: true;
  readonly size: number;
  readonly content_type: string;
  readonly body: ReadableStream<Uint8Array>;
}

/** The site as a backup holds it: without its folder, and with every version it keeps or with its live one alone. */
function exported(site: Site, allVersions: boolean): ExportedSite {
  const { folder, ...kept } = site;
  if (allVersions) return kept;

  return { ...kept, versions: site.versions.filter((version) => version.number === site.live_version) };
}

/** Find the site a reference names, and check that it keeps a version. */
async function reachVersion(install: Install, actor: Actor, asked: { readonly site: string; readonly version: number }): Promise<{ readonly ok: true; readonly site: Site } | Refused<SiteCode | "no_such_version">> {
  const reached = await reachSite(install, actor, asked.site);
  if (!reached.ok) return reached;

  if (!reached.site.versions.some((version) => version.number === asked.version)) return refuse("no_such_version");

  return { ok: true, site: reached.site };
}

/**
 * Read every setting in the text form it is typed in, which `importSettings` reads back.
 *
 * @returns the texts under the backup's format number, `not_allowed` for anyone but an admin, or `not_set_up` before setup stored the settings
 */
export async function exportSettings(
  install: Install,
  actor: Actor,
): Promise<({ readonly ok: true } & Readonly<v.InferOutput<typeof EXPORTED_SETTINGS>>) | Refused<"not_allowed" | "not_set_up">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const values = await install.database.readSettings();
  if (values === undefined) return refuse("not_set_up");

  return { ok: true, format: BACKUP_FORMAT, settings: settingsToText(values) };
}

/**
 * Read one page of every site as it is stored, the trash included: what `beginImport` takes as `site`.
 *
 * @param query - `limit` is 1 to 100; `after` is the `next` of the page before; `all_versions` gives every kept version of each site instead of its live one alone
 * @returns the page, `not_allowed` for anyone but an admin, or `bad_argument` naming the key that was refused
 */
export async function exportSites(install: Install, actor: Actor, query: v.InferInput<typeof EXPORT_QUERY> = {}): Promise<ExportedSites | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(EXPORT_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "query");

  const { limit, after, all_versions: allVersions } = asked.output;
  const page = await install.database.exportSites(after === undefined ? { limit } : { limit, after });
  const sites = page.sites.map((site) => exported(site, allVersions));
  if (page.next === undefined) return { ok: true, format: BACKUP_FORMAT, sites };

  return { ok: true, format: BACKUP_FORMAT, sites, next: page.next };
}

/**
 * Read one site as it is stored, in the trash or not.
 *
 * @param request - `site` is a reference to the site; `all_versions` gives every kept version instead of the live one alone
 * @returns the site under the backup's format number, or `not_allowed` for anyone but an admin
 */
export async function exportSite(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof EXPORT_SITE_QUERY> & { readonly site: string },
): Promise<{ readonly ok: true; readonly format: typeof BACKUP_FORMAT; readonly site: ExportedSite } | Refused<SiteCode>> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const reached = await reachSite(install, actor, request.site);
  if (!reached.ok) return reached;

  return { ok: true, format: BACKUP_FORMAT, site: exported(reached.site, request.all_versions === true) };
}

/**
 * List one page of the files one kept version of a site holds, from the store: one listing a call.
 *
 * @param request - `site` is a reference to the site and `version` one of its kept versions; `limit` is 1 to 1000; `cursor` is the `next` of the page before, of the same site and version
 * @returns each file's path in the version and its length, or `no_such_version` for a version the site does not keep
 * @throws {Error} the store failed, or refused the cursor
 */
export async function exportFiles(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof EXPORT_FILES_QUERY> & { readonly site: string },
): Promise<ExportedFiles | Refused<SiteCode | "no_such_version">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const { site: reference, ...query } = request;
  const asked = v.safeParse(EXPORT_FILES_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "query");

  const { version, limit, cursor } = asked.output;
  const reached = await reachVersion(install, actor, { site: reference, version });
  if (!reached.ok) return reached;

  const prefix = versionPrefix(reached.site.folder, version);
  const paging = cursor === undefined ? {} : { cursor: cursor as ListCursor };
  const page = await install.store.list({ prefix, limit, ...paging });
  const files = page.objects.map((object) => ({ path: object.key.slice(prefix.length), size: object.size }));
  if (!page.more) return { ok: true, files };

  return { ok: true, files, next: page.cursor };
}

/**
 * Read one stored file of one kept version of a site. The key is built by `fileKey` alone, so no path reaches outside that version.
 *
 * @param request - `site` is a reference to the site, `version` one of its kept versions, and `path` the file's path in that version
 * @returns the file. `no_such_version` for a version the site does not keep, and `not_found` about `path` for a path that is none or that the version does not hold
 * @throws {Error} the store failed
 */
export async function exportFile(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof EXPORT_FILE_QUERY> & { readonly site: string },
): Promise<ExportedFile | Refused<SiteCode | "no_such_version">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const reached = await reachVersion(install, actor, request);
  if (!reached.ok) return reached;

  const key = fileKey(reached.site.folder, request.version, request.path);
  if (!key.ok) return refuse("not_found", "path");

  const read = await install.store.read(key.key);
  if (read.kind !== "found") return refuse("not_found", "path");

  return { ok: true, size: read.info.size, content_type: read.info.contentType, body: read.body };
}
