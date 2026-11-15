// The database interface over SQLite. Every SQL text poplin runs outside a migration step is in this file, and every row leaves it as a checked value.
//
// A change is one batch: the statement that changes a row carries its own condition, and each statement after it runs only when the one before it changed a row.
// So a change and its audit entry are kept together or not at all, and nothing is decided from an earlier read.

import { and, asc, desc, eq, exists, getTableName, gt, isNotNull, isNull, lt, ne, notExists, or, type SQL, sql as fragment } from "drizzle-orm";
import { alias, type SQLiteColumn, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as v from "valibot";

import type { ComputerLogin, LoginId, PendingLogin, UserCode } from "../auth/computer-logins";
import type { TokenId, TokenRecord } from "../auth/tokens";
import type { PublicName, SiteName } from "../names/names";
import { type AuditAction, type AuditEntry, auditFromRow } from "../records/audit";
import { computerLoginFromRow } from "../records/computer-login";
import { SITE_ID, SITE_NAME } from "../records/fields";
import { SETTING_CHANGES, SETTING_VALUES, type SettingValues } from "../records/settings";
import { signingKeyFromRow, signingKeyToText, type UpdateAddress, updateAddressFromRow } from "../records/secret";
import { NEW_SITE, SITE_DETAILS, SITE_FOLDER, type Site, type SiteAccess, type SiteFolder, siteFromRow, siteToRow } from "../records/site";
import { SWEEP_PLACE, type SweepPlace } from "../records/sweep-place";
import { UPDATE_CHECK, type UpdateCheck } from "../records/update";
import { type Totals, totalsFromRow } from "../records/sizes";
import { mintSiteId, type SiteId } from "../sites/ids";
import { tokenFromRow } from "../records/token";
import { type ManifestFile, type Upload, type UploadId, uploadFromRow } from "../records/upload";
import { dayOf, type SiteViews, viewDays } from "../records/views";
import type {
  AuditQuery,
  Address,
  AuditNote,
  CountedRequests,
  Database,
  Done,
  ExportPage,
  LeftoversPage,
  LoginDecision,
  LoginRoom,
  NewSite,
  NewUpload,
  NewVersion,
  Published,
  Refused,
  RequestCounts,
  Reserved,
  Signed,
  SigningKey,
  SiteDetails,
  SitesPage,
  SitesQuery,
  Unchanged,
  UploadedVersion,
  UploadRoom,
  UploadsPage,
} from "./database";
import type { SqlDriver, SqlValue, Statement, StatementResult } from "./driver";
import { fileUnderKey, manifestFromText, manifestKey, manifestToText } from "./manifest";
import { audit, declaredFiles, leftovers, requestCounts, sites, totals, uploads, versions } from "./schema";

/** How many ids are tried for one site before giving up; an id is about 62 random bits, so a second try is already a rare event. */
const MINT_ATTEMPTS = 5;

/** The most rows one page of a listing holds. */
const MAX_PAGE = 100;

/** A `before` that every audit entry is below. */
const NEWEST = Number.MAX_SAFE_INTEGER;

/** Where statements are built from the declared schema. None is run here: each goes to the driver, in a batch. */
const BUILD = drizzle(() => Promise.reject(new Error("a statement is run by the driver, in a batch")));

/** True when the statement before it in the batch changed one row. */
const CHANGED = fragment`changes() = 1`;

/** A row that stands for "there is one" in a subquery. */
const ONE = { one: fragment`1` };

/** The columns an audit entry is written with; `seq` is the engine's to give. */
const AUDIT_COLUMNS = [audit.at, audit.actor, audit.action, audit.site_id, audit.site_name, audit.detail];

/** The columns a version is written with. */
const VERSION_COLUMNS = [versions.folder, versions.number, versions.published_at, versions.published_by, versions.bytes, versions.files];

/** Every column of an upload but its manifest. */
const UPLOAD_FIELDS = {
  id: uploads.id,
  folder: uploads.folder,
  number: uploads.number,
  owner: uploads.owner,
  state: uploads.state,
  plan: uploads.plan,
  bytes: uploads.bytes,
  files: uploads.files,
  dropped: uploads.dropped,
  created_at: uploads.created_at,
};

/** The bytes of every pending upload and every kept version together. */
const BYTES_HELD = fragment`((SELECT COALESCE(SUM(${uploads.bytes}), 0) FROM ${uploads} WHERE ${uploads.state} = 'pending') + (SELECT ${totals.bytes} FROM ${totals} WHERE ${totals.id} = 1))`;

/** The sites there are and the ones the pending uploads would make. Only a new site's upload has number 1. */
const SITES_HELD = fragment`((SELECT COALESCE(SUM(${uploads.number} = 1), 0) FROM ${uploads} WHERE ${uploads.state} = 'pending') + (SELECT ${totals.sites} FROM ${totals} WHERE ${totals.id} = 1))`;

/** The `uploads` table as `u`, for a subquery inside a statement on the same table. In the template an alias stands for its short name alone, so a FROM names the table before it. */
const AN_UPLOAD = alias(uploads, "u");

/** The `sites` table as `s`. */
const ITS_SITE = alias(sites, "s");

/** The `versions` table as `v`. */
const A_VERSION = alias(versions, "v");

/** The `versions` table as `k`, for the kept versions inside a subquery on `v`. */
const A_KEPT_VERSION = alias(versions, "k");

/** The `sites` table under a second name, for a statement that asks about the other sites. */
const OTHER = alias(sites, "other");

/** A site with its kept versions gathered into one JSON column, so one statement gives the whole site. */
const SITE_FIELDS = {
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

/** The id and the name of a site, as `getSiteNames` reads them. */
const NAMED_SITE = v.object({ id: SITE_ID, name: SITE_NAME });

/** The audit entry of a change to no site, written only when the statement before it changed a row. */
const AUDIT_PLAIN = "INSERT INTO audit (at, actor, action, detail) SELECT ?1, ?2, ?3, ?4 WHERE changes() = 1";

/** An audit entry that goes with no change. */
const AUDIT_NOTE = "INSERT INTO audit (at, actor, action, site_id, site_name, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)";

/** The place of each access in a listing sorted by access: from the most private to the most open. */
const ACCESS_RANKS = { private: 0, unlisted: 1, public: 2 } as const;

/** The same places, as the listing's statement computes them. */
const ACCESS_RANK = fragment`CASE ${sites.access} ${fragment.raw(
  Object.entries(ACCESS_RANKS)
    .map(([access, rank]) => `WHEN '${access}' THEN ${rank}`)
    .join(" "),
)} END`;

/** The direction a listing takes when none is asked: the last change first, a name and an access from the start. */
const DEFAULT_DIRECTIONS = { updated: "desc", name: "asc", access: "asc" } as const;

/** The conditions that narrow a listing to what its query asks for: the trash or not, and each filter given. */
function narrowing(query: SitesQuery): SQL[] {
  const conditions: SQL[] = [eq(sites.trashed, query.trash ? 1 : 0)];

  if (query.owner !== undefined) conditions.push(eq(sites.owner, query.owner));

  // The text is looked for as it stands, with no sign read as a pattern. A name holds no capital, so one typed with capitals is looked for without.
  if (query.named !== undefined) conditions.push(fragment`instr(${sites.name}, ${query.named.toLowerCase()}) > 0`);

  if (query.access !== undefined) conditions.push(eq(sites.access, query.access));

  if (query.expires !== undefined) conditions.push(query.expires === "set" ? isNotNull(sites.expires_at) : isNull(sites.expires_at));

  return conditions;
}

/** Every column of a token. */
const SELECT_TOKEN = "SELECT id, hash, scope, note, created_at, expires_at FROM tokens";

/** A new token, only while its id is free. */
const INSERT_TOKEN =
  "INSERT INTO tokens (id, hash, scope, note, created_at, expires_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM tokens WHERE id = ?1)";

/** The audit entry of a revoked token, written while the token is still there to name. */
const AUDIT_REVOKE = `
INSERT INTO audit (at, actor, action, detail)
SELECT ?1, ?2, 'token_revoked', json_object('token', id, 'scope', scope, 'note', note) FROM tokens WHERE id = ?3`;

/** The removal itself, only when its audit entry was written. */
const DELETE_TOKEN = "DELETE FROM tokens WHERE id = ?1 AND changes() = 1";

/** Every column of a login. */
const SELECT_LOGIN = "SELECT id, code, hash, scope, computer, visitor, state, decided_by, created_at, expires_at FROM logins";

/** Every login that waits at `?1`, pending and not run out, the newest first. */
const SELECT_WAITING_LOGINS = `${SELECT_LOGIN} WHERE state = 'pending' AND expires_at > ?1 ORDER BY created_at DESC, id DESC`;

/** Whether id `?1` and code `?2` are both free, so the login that brings them will be stored. */
const LOGIN_IS_NEW = "NOT EXISTS (SELECT 1 FROM logins WHERE id = ?1 OR code = ?2)";

/** Room for a new login of visitor `?4`: of that visitor's logins that wait at `?3`, pending and not run out, all but the newest `?5` are removed. */
const MAKE_ROOM_OF_VISITOR = `
DELETE FROM logins
WHERE id IN (SELECT id FROM logins WHERE visitor = ?4 AND state = 'pending' AND expires_at > ?3 ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?5) AND ${LOGIN_IS_NEW}`;

/** The logins that wait at `?3`, one row a visitor: how many, and the oldest as its `created_at` in sixteen digits then its id, a text that sorts as the pair does. */
const WAITING_BY_VISITOR = "SELECT COUNT(*) AS held, MIN(printf('%016d', created_at) || id) AS oldest FROM logins WHERE state = 'pending' AND expires_at > ?3 GROUP BY visitor";

/** Room for a new login among all: once `?4` logins wait at `?3`, the oldest one of the visitor with the most is removed. One pass finds it: `9999 - held` in four digits puts the visitor with the most first. */
const MAKE_ROOM_OF_ALL = `
DELETE FROM logins
WHERE id = (SELECT CASE WHEN SUM(held) >= ?4 THEN substr(MIN(printf('%04d', 9999 - held) || oldest), 21) END FROM (${WAITING_BY_VISITOR})) AND ${LOGIN_IS_NEW}`;

/** A new login, pending, only while its id and its code are free. */
const INSERT_LOGIN = `
INSERT INTO logins (id, code, hash, scope, computer, visitor, created_at, expires_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE ${LOGIN_IS_NEW}`;

/** The login under code `?1` allowed or denied by `?3`, only while it is pending and has not run out at `?4`. With `?5` an allowed one becomes a publisher's. */
const DECIDE_LOGIN = `
UPDATE logins SET state = ?2, decided_by = ?3, scope = CASE WHEN ?5 = 1 AND ?2 = 'allowed' THEN 'publisher' ELSE scope END
WHERE code = ?1 AND state = 'pending' AND expires_at > ?4`;

/** The audit entry of a decided login, written only when the statement before it changed a row. It names the scope and the computer, and nothing of the secret. */
const AUDIT_LOGIN = `
INSERT INTO audit (at, actor, action, detail)
SELECT ?1, ?2, ?3, json_object('scope', scope, 'computer', computer) FROM logins WHERE code = ?4 AND changes() = 1`;

/** A token for login `?1`, only while the login is allowed, has not run out at `?5`, and is of the token's scope `?7`. */
const INSERT_TOKEN_OF_LOGIN = `
INSERT INTO tokens (id, hash, scope, note, created_at, expires_at)
SELECT ?2, ?3, l.scope, ?4, ?5, ?6 FROM logins l
WHERE l.id = ?1 AND l.state = 'allowed' AND l.expires_at > ?5 AND l.scope = ?7 AND NOT EXISTS (SELECT 1 FROM tokens WHERE id = ?2)`;

/** The audit entry of that token, signed by whoever allowed login `?2`, written only when the token was stored. */
const AUDIT_TOKEN_OF_LOGIN = "INSERT INTO audit (at, actor, action, detail) SELECT ?1, decided_by, 'token_added', ?3 FROM logins WHERE id = ?2 AND changes() = 1";

/** The login removed, only when its token's audit entry was written. */
const DELETE_REDEEMED_LOGIN = "DELETE FROM logins WHERE id = ?1 AND changes() = 1";

/** Every login that ran out at or before `?1`, removed. */
const DELETE_OLD_LOGINS = "DELETE FROM logins WHERE expires_at <= ?1";

/** Where the sweep's walk stopped, as JSON text. */
const READ_SWEEP_PLACE = "SELECT place FROM sweep_place WHERE id = 1";

/** Where the sweep's walk stopped, in place of what was kept. */
const KEEP_SWEEP_PLACE = "INSERT INTO sweep_place (id, place) VALUES (1, ?1) ON CONFLICT (id) DO UPDATE SET place = excluded.place";

/** The sweep's place forgotten. */
const FORGET_SWEEP_PLACE = "DELETE FROM sweep_place";

/** When the newest release was last asked for, and the newest known, as JSON text or NULL. */
const READ_UPDATE_CHECK = "SELECT checked_at, news FROM update_check WHERE id = 1";

/** The last asking and its answer, in place of what was kept. */
const KEEP_UPDATE_CHECK = "INSERT INTO update_check (id, checked_at, news) VALUES (1, ?1, ?2) ON CONFLICT (id) DO UPDATE SET checked_at = excluded.checked_at, news = excluded.news";

/** The settings, as JSON text. */
const READ_SETTINGS = "SELECT value FROM settings WHERE id = 1";

/** The settings of a new install, only while none are stored. */
const INSERT_SETTINGS = "INSERT INTO settings (id, value, updated_at) SELECT 1, ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1)";

/** A merge patch: each key it names is replaced and every other key stays, in one statement, only when a value differs. */
const PATCH_SETTINGS = "UPDATE settings SET value = json_patch(value, ?1), updated_at = ?2 WHERE id = 1 AND json(json_patch(value, ?1)) <> json(value)";

/** The signing key, as hex text. */
const READ_SIGNING_KEY = "SELECT value FROM secrets WHERE name = 'session_key'";

/** A signing key, only while none is stored. */
const INSERT_SIGNING_KEY =
  "INSERT INTO secrets (name, value, created_at) SELECT 'session_key', ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM secrets WHERE name = 'session_key')";

/** A signing key in place of the stored one, or as the first. */
const REPLACE_SIGNING_KEY = `
INSERT INTO secrets (name, value, created_at) VALUES ('session_key', ?1, ?2)
ON CONFLICT (name) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`;

/** The address that starts a rebuild, with the moment it was saved. */
const READ_UPDATE_ADDRESS = "SELECT value, created_at FROM secrets WHERE name = 'update_address'";

/** An address that starts a rebuild in place of the stored one, or as the first. */
const KEEP_UPDATE_ADDRESS = `
INSERT INTO secrets (name, value, created_at) VALUES ('update_address', ?1, ?2)
ON CONFLICT (name) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`;

/** No address that starts a rebuild. */
const FORGET_UPDATE_ADDRESS = "DELETE FROM secrets WHERE name = 'update_address'";

/** Whether any audit entry is a login. The scan runs from the oldest entry and stops at the first, which sits near the start of every log that has one. */
const HAS_LOGIN = "SELECT EXISTS (SELECT 1 FROM audit WHERE action = 'login') AS found";

/** The form of a day: a date such as `2026-11-13`, which sorts as text in the order of time. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The site column of the row that counts all sites together; no site id is empty. */
const ALL_SITES = "";

/** The counts of every day before `?1`, dropped so the table holds seven days. */
const DROP_EARLIER_DAYS = "DELETE FROM request_counts WHERE day < ?1";

/** `?3` more requests on day `?1` for site `?2`, `?4` of them page views, and the count of requests after them. */
const ADD_REQUESTS = `
INSERT INTO request_counts (day, site, requests, views) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT (day, site) DO UPDATE SET requests = requests + excluded.requests, views = views + excluded.views
RETURNING requests`;

/** The page views of each site in the JSON list `?2` over the days in the JSON list `?1`, and those of day `?3` among them. Every row is found by its key. */
const READ_VIEWS = `
SELECT c.site AS site, SUM(c.views) AS week, SUM(CASE WHEN c.day = ?3 THEN c.views ELSE 0 END) AS today
FROM json_each(?2) AS s CROSS JOIN json_each(?1) AS d
JOIN request_counts AS c ON c.day = d.value AND c.site = s.value
GROUP BY c.site`;

/** The most sites one read of views takes: a page of a listing. */
const MOST_VIEWED_SITES = 100;

/** The count of day `?1` for site `?2`; no row when nothing was counted. */
const READ_REQUESTS = "SELECT requests FROM request_counts WHERE day = ?1 AND site = ?2";

/** What the builder gives for one statement. */
interface BuiltQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function sql(text: string, ...params: SqlValue[]): Statement {
  return { sql: text, params };
}

/**
 * A column with its table's name before it.
 * A built statement that reads one table writes its selected columns bare, and a subquery inside the selection would read a bare column as its own.
 */
function qualified(column: SQLiteColumn): SQL {
  return fragment`${fragment.identifier(getTableName(column.table))}.${fragment.identifier(column.name)}`;
}

/** A column by its name alone, as the column list of an `INSERT` takes it. */
function bare(column: SQLiteColumn): SQL {
  return fragment`${fragment.identifier(column.name)}`;
}

/** The kept versions of the site a statement selects, gathered into one JSON value. */
function versionsOfSite(): SQL<string> {
  const kept = [versions.number, versions.published_at, versions.published_by, versions.bytes, versions.files];
  const pairs = kept.map((column) => fragment`${fragment.raw(`'${column.name}'`)}, ${qualified(column)}`);
  const version = fragment`json_object(${fragment.join(pairs, fragment`, `)})`;

  return fragment<string>`(SELECT json_group_array(${version}) FROM ${versions} WHERE ${qualified(versions.folder)} = ${qualified(sites.folder)})`;
}

/** A built statement as the driver takes it. */
function built(query: { toSQL(): BuiltQuery } | { getQuery(): BuiltQuery }): Statement {
  const { sql: text, params } = "toSQL" in query ? query.toSQL() : query.getQuery();

  return { sql: text, params: params as SqlValue[] };
}

/** The sites a condition holds for, each with its kept versions. */
function sitesWhere(condition: SQL | undefined): Statement {
  return built(BUILD.select(SITE_FIELDS).from(sites).where(condition));
}

/** The site with the given id, with its kept versions. */
function siteById(id: SiteId): Statement {
  return sitesWhere(eq(sites.id, id));
}

/** Added to a lookup by address: the site is outside the trash and not past its expiry at `now`. */
function isServed(now: number): SQL | undefined {
  return and(eq(sites.trashed, 0), or(isNull(sites.expires_at), gt(sites.expires_at, now)));
}

/** A new access for a live site, only when it differs and the public name asked for is free: no other site has it as its public name, and no site as its id. */
function setAccess(id: SiteId, access: SiteAccess["access"], publicName: PublicName | null): Statement {
  const heldByAnother = (name: PublicName): SQL | undefined => and(eq(OTHER.public_name, name), ne(OTHER.id, id));
  const isFree = (name: PublicName): SQL | undefined =>
    and(notExists(BUILD.select(ONE).from(OTHER).where(heldByAnother(name))), notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.id, name))));
  const differs = or(ne(sites.access, access), fragment`${sites.public_name} IS NOT ${publicName}`);
  const live = and(eq(sites.id, id), eq(sites.trashed, 0), differs, publicName === null ? undefined : isFree(publicName));

  return built(BUILD.update(sites).set({ access, public_name: publicName }).where(live));
}

/** The details given, as the columns of `sites` store them. */
function storedDetails(given: SiteDetails): Partial<Pick<typeof sites.$inferInsert, "name" | "title" | "search_engines" | "embeddable" | "expires_at">> {
  return {
    ...(given.name === undefined ? {} : { name: given.name }),
    ...(given.title === undefined ? {} : { title: given.title }),
    ...(given.search_engines === undefined ? {} : { search_engines: given.search_engines ? 1 : 0 }),
    ...(given.embeddable === undefined ? {} : { embeddable: given.embeddable ? 1 : 0 }),
    ...(given.expires === undefined ? {} : { expires_at: given.expires === "never" ? null : given.expires }),
  };
}

/** A statement written with the template, for what the builder has no word for. */
function written(text: SQL): Statement {
  return built(BUILD.all(text));
}

/**
 * An `INSERT` of the columns named, from a `SELECT`.
 * The insert builder names every column of a table, and a key the engine would give costs one row read more when it is named.
 */
function insertFrom(table: SQLiteTable, columns: readonly SQLiteColumn[], select: SQL): Statement {
  return written(fragment`INSERT INTO ${table} (${fragment.join(columns.map(bare), fragment`, `)}) ${select}`);
}

/** The audit entry of a change to the site now at the given id, written only when the statement before it changed a row. */
function auditOfSite(signed: Signed, action: AuditAction, id: SiteId, detail: Readonly<Record<string, unknown>>): Statement {
  const entry = fragment`SELECT ${signed.at}, ${signed.by}, ${action}, ${sites.id}, ${sites.name}, ${JSON.stringify(detail)} FROM ${sites} WHERE ${sites.id} = ${id} AND ${CHANGED}`;

  return insertFrom(audit, AUDIT_COLUMNS, entry);
}

/** The upload with the given id, without its manifest; none for no id. */
function uploadById(id: UploadId | null): Statement {
  return built(BUILD.select(UPLOAD_FIELDS).from(uploads).where(fragment`${uploads.id} = ${id}`));
}

/** An upload marked finished and its manifest dropped, only when the statement before it changed a row. */
function finishUpload(id: UploadId | null): Statement {
  return built(BUILD.update(uploads).set({ state: "finished", manifest: "{}" }).where(and(fragment`${uploads.id} = ${id}`, CHANGED)));
}

/** How many pending uploads a holder began. */
function pendingOf(owner: string): SQL {
  return fragment`(SELECT COUNT(*) FROM ${uploads} WHERE ${uploads.state} = 'pending' AND ${uploads.owner} = ${owner})`;
}

/** The bytes a folder would hold: what its pending uploads declare, and the `staying` newest kept versions of its site. */
function bytesIn(folder: string, staying: number): SQL {
  const pending = fragment`(SELECT COALESCE(SUM(${uploads.bytes}), 0) FROM ${uploads} WHERE ${uploads.state} = 'pending' AND ${uploads.folder} = ${folder})`;
  const newest = fragment`(SELECT ${versions.number} FROM ${versions} WHERE ${versions.folder} = ${folder} ORDER BY ${versions.number} DESC LIMIT ${staying})`;

  return fragment`(${pending} + (SELECT COALESCE(SUM(${versions.bytes}), 0) FROM ${versions} WHERE ${versions.folder} = ${folder} AND ${versions.number} IN ${newest}))`;
}

/** Whether no site has a name as its id, and none as its public name. */
function isFree(name: string): SQL | undefined {
  return and(notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.id, name))), notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.public_name, name))));
}

/** A new site, only while its id and its public name are free, and its upload, when it has one, is pending as the first version of its folder. Its owner is whoever began that upload, or `signed.by`. */
function insertSite(id: SiteId, site: v.InferOutput<typeof NEW_SITE>, signed: Signed, upload: UploadId | undefined): Statement {
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
function publicNameIsFree(publicName: PublicName | null, id: SiteId): SQL | undefined {
  return publicName === null ? undefined : and(fragment`${publicName} <> ${id}`, isFree(publicName));
}

/** Whether an upload is pending as the first version of a folder. */
function isFirstPending(upload: UploadId, folder: SiteFolder): SQL {
  return exists(BUILD.select(ONE).from(uploads).where(and(eq(uploads.id, upload), eq(uploads.state, "pending"), eq(uploads.folder, folder), eq(uploads.number, 1))));
}

/** The folder of an upload, as a subquery. */
function folderOf(upload: UploadId): SQL {
  return fragment`(SELECT ${uploads.folder} FROM ${uploads} WHERE ${uploads.id} = ${upload})`;
}

/** Whether an upload can be made its site's next version: it is pending, its site is live, and its number was set aside and is above every kept one. */
function canPublish(upload: UploadId): SQL {
  const above = fragment`(SELECT MAX(${A_VERSION.number}) FROM ${versions} ${A_VERSION} WHERE ${A_VERSION.folder} = ${ITS_SITE.folder})`;
  const ready = fragment`${AN_UPLOAD.id} = ${upload} AND ${AN_UPLOAD.state} = 'pending' AND ${ITS_SITE.trashed} = 0 AND ${AN_UPLOAD.number} < ${ITS_SITE.next_version} AND ${AN_UPLOAD.number} > ${above}`;

  return fragment`EXISTS (SELECT 1 FROM ${uploads} ${AN_UPLOAD} JOIN ${sites} ${ITS_SITE} ON ${ITS_SITE.folder} = ${AN_UPLOAD.folder} WHERE ${ready})`;
}

/** Whether the site of an upload has the access asked with it, under the public name asked; true when no access is asked. */
function hasAccess(upload: UploadId, access: string | null, publicName: string | null): SQL {
  const asked = fragment`${sites.folder} = ${folderOf(upload)} AND ${sites.access} = ${access} AND ${sites.public_name} IS ${publicName}`;

  return fragment`(${access} IS NULL OR EXISTS (SELECT 1 FROM ${sites} WHERE ${asked}))`;
}

/** The audit entry of a change made with an upload to its site, written only when the statement before it changed a row. */
function auditWithUpload(signed: Signed, action: AuditAction, upload: UploadId, detail: Readonly<Record<string, unknown>>): Statement {
  const entry = fragment`SELECT ${signed.at}, ${signed.by}, ${action}, ${sites.id}, ${sites.name}, ${JSON.stringify(detail)} FROM ${sites} WHERE ${sites.folder} = ${folderOf(upload)} AND ${CHANGED}`;

  return insertFrom(audit, AUDIT_COLUMNS, entry);
}

/** A kept version of a site, as a subquery of a statement on `sites` asks for it. */
function keptVersion(condition: SQL): SQL {
  return fragment`FROM ${versions} WHERE ${versions.folder} = ${sites.folder} AND ${condition}`;
}

/** The kept version a move of the live version goes to: the number given, or the highest below the live one. */
function moveLive(id: SiteId, target: number | "previous", at: number): Statement {
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
function dropOldVersions(folder: SQL, keep: number): Statement {
  const highest = fragment`(SELECT ${versions.number} FROM ${versions} WHERE ${versions.folder} = ${folder} ORDER BY ${versions.number} DESC LIMIT ${keep})`;

  return built(BUILD.delete(versions).where(fragment`${CHANGED} AND ${versions.folder} = ${folder} AND ${versions.number} NOT IN ${highest}`));
}

function auditPlain(signed: Signed, action: AuditAction, detail: Readonly<Record<string, unknown>>): Statement {
  return sql(AUDIT_PLAIN, signed.at, signed.by, action, JSON.stringify(detail));
}

function requirePage(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new RangeError(`a page holds 1 to ${MAX_PAGE} rows, not ${limit}`);
}

/** A cursor carries what its listing goes by: a listing by name the last site's name, one by access its access. */
function requireCursor(query: SitesQuery): void {
  const { after, sort } = query;
  if (after === undefined || (sort !== "name" && sort !== "access")) return;

  if (after[sort] === undefined) throw new RangeError(`a page after another of a listing by ${sort} names the ${sort} of that page's last site`);
}

function requireCount(what: string, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`${what} is a whole number from 0 up, not ${count}`);
}

function publicNameOf(access: SiteAccess): PublicName | null {
  return access.access === "public" ? access.public_name : null;
}

function siteIn(result: StatementResult | undefined): Site | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : siteFromRow(row);
}

function changed(result: StatementResult | undefined): boolean {
  return (result?.changes ?? 0) > 0;
}

function done(result: StatementResult | undefined): Done {
  const site = siteIn(result);
  if (site === undefined) throw new Error("a change to a site was made and the site is not there to read");

  return { kind: "done", site };
}

/** Why a site that is live could not be changed: there is none, or it sits in the trash. `undefined` for a live site. */
function unreachable(site: Site | undefined): Refused<"not_found" | "in_trash"> | undefined {
  if (site === undefined) return { kind: "not_found" };

  if (site.state === "trash") return { kind: "in_trash" };

  return undefined;
}

function uploadIn(result: StatementResult | undefined): Upload | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : uploadFromRow(row);
}

function loginIn(result: StatementResult | undefined): ComputerLogin | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : computerLoginFromRow(row);
}

function signingKeyIn(result: StatementResult | undefined): Uint8Array<ArrayBuffer> | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : signingKeyFromRow(row);
}

function placeIn(result: StatementResult | undefined): SweepPlace | undefined {
  const text = result?.rows[0]?.place;
  if (typeof text !== "string") return undefined;

  const place = v.safeParse(SWEEP_PLACE, JSON.parse(text));

  return place.success ? place.output : undefined;
}

function updateCheckIn(result: StatementResult | undefined): UpdateCheck | undefined {
  const row = result?.rows[0];
  if (row === undefined) return undefined;

  const news: unknown = typeof row.news === "string" ? JSON.parse(row.news) : null;
  const check = v.safeParse(UPDATE_CHECK, { checked_at: row.checked_at, news });

  return check.success ? check.output : undefined;
}

function settingsIn(result: StatementResult | undefined): SettingValues | undefined {
  const value = result?.rows[0]?.value;
  if (typeof value !== "string") return undefined;

  return v.parse(SETTING_VALUES, JSON.parse(value));
}

function requireDay(day: string): void {
  if (!DAY_PATTERN.test(day)) throw new RangeError(`a day is a date such as 2026-11-13, not ${JSON.stringify(day)}`);
}

function requestsIn(result: StatementResult | undefined): number {
  return Number(result?.rows[0]?.requests ?? 0);
}

/** Core's database over any SQLite a driver reaches: D1 in the Worker, `bun:sqlite` in the tests. */
export class SqlDatabase implements Database {
  readonly #driver: SqlDriver;

  readonly #mintId: () => SiteId;

  /**
   * @param driver - a database already at the current schema version
   * @param mintId - makes a candidate site id; the default draws 12 random base36 characters
   */
  constructor(driver: SqlDriver, mintId: () => SiteId = mintSiteId) {
    this.#driver = driver;
    this.#mintId = mintId;
  }

  async createSite(draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken">> {
    const made = await this.#insertSite(draft, signed);
    if (made.kind === "done") return made;

    if (made.kind === "not_pending") throw new Error("a site made from no upload waits for none");

    return { kind: "name_taken" };
  }

  async getSite(id: SiteId): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([siteById(id)]);

    return siteIn(found);
  }

  async getSiteNames(ids: readonly SiteId[]): Promise<ReadonlyMap<SiteId, SiteName>> {
    const names = BUILD.select({ id: sites.id, name: sites.name }).from(sites).where(fragment`${sites.id} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`);
    const [found] = await this.#driver.batch([built(names)]);
    const named = (found?.rows ?? []).map((row) => v.parse(NAMED_SITE, row));

    return new Map(named.map(({ id, name }) => [id, name]));
  }

  async getSiteByPublicName(name: PublicName): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([sitesWhere(eq(sites.public_name, name))]);

    return siteIn(found);
  }

  async getSiteByFolder(folder: Site["folder"]): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([sitesWhere(eq(sites.folder, folder))]);

    return siteIn(found);
  }

  async findServed(address: Address, now: number): Promise<Site | undefined> {
    const addressed = "id" in address ? eq(sites.id, address.id) : eq(sites.public_name, address.public_name);
    const [found] = await this.#driver.batch([sitesWhere(and(addressed, isServed(now)))]);

    return siteIn(found);
  }

  async listSites(query: SitesQuery): Promise<SitesPage> {
    requirePage(query.limit);
    requireCursor(query);

    // The trash is listed by when each site went there, the sites by when their content last changed.
    const moment = query.trash ? sites.trashed_at : sites.updated_at;
    const sort = query.sort ?? "updated";
    const descending = (query.dir ?? DEFAULT_DIRECTIONS[sort]) === "desc";
    const column = { updated: fragment`${moment}`, name: fragment`${sites.name}`, access: ACCESS_RANK }[sort];
    const conditions = narrowing(query);

    if (query.after !== undefined) {
      const { after } = query;
      const place = { updated: after.updated_at, name: after.name ?? "", access: ACCESS_RANKS[after.access ?? "private"] }[sort];
      conditions.push(fragment`(${column}, ${sites.id}) ${descending ? fragment`<` : fragment`>`} (${place}, ${after.id})`);
    }

    // One row more than the page shows whether another page follows.
    const page = BUILD.select(SITE_FIELDS).from(sites).where(and(...conditions)).orderBy(descending ? desc(column) : asc(column), descending ? desc(sites.id) : asc(sites.id)).limit(query.limit + 1);
    const [listed] = await this.#driver.batch([built(page)]);
    const listedSites = (listed?.rows ?? []).slice(0, query.limit).map(siteFromRow);
    const last = listedSites.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { sites: listedSites };

    const listedBy = { updated: {}, name: { name: last.name }, access: { access: last.access } }[sort];

    return { sites: listedSites, next: { updated_at: last.state === "trash" ? last.trashed_at : last.updated_at, id: last.id, ...listedBy } };
  }

  async changeAccess(id: SiteId, access: SiteAccess, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">> {
    const publicName = publicNameOf(access);
    const [updated, , after] = await this.#driver.batch([
      setAccess(id, access.access, publicName),
      auditOfSite(signed, "access", id, { access: access.access, public_name: publicName }),
      siteById(id),
    ]);
    if (changed(updated)) return done(after);

    const site = siteIn(after);
    const refusal = unreachable(site);
    if (site === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    if (site.access === access.access && publicNameOf(site) === publicName) return { kind: "unchanged", site };

    return { kind: "name_taken" };
  }

  async changeDetails(id: SiteId, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash">> {
    const given = v.parse(SITE_DETAILS, details);
    const stored = storedDetails(given);
    const columns = Object.keys(stored) as (keyof typeof stored)[];
    if (columns.length === 0) return this.#unchanged(id);

    const differs = or(...columns.map((column) => fragment`${sites[column]} IS NOT ${stored[column] ?? null}`));
    const update = BUILD.update(sites).set(stored).where(and(eq(sites.id, id), eq(sites.trashed, 0), differs));
    const [updated, , after] = await this.#driver.batch([built(update), auditOfSite(signed, "details", id, given), siteById(id)]);
    if (changed(updated)) return done(after);

    return this.#unchangedIn(after);
  }

  async giveNewId(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const next = this.#mintId();
      const days = JSON.stringify(viewDays(dayOf(signed.at)));
      const [updated, , after, before] = await this.#driver.batch([
        built(BUILD.update(sites).set({ id: next }).where(and(eq(sites.id, id), eq(sites.trashed, 0), isFree(next)))),
        auditOfSite(signed, "new_id", next, { from: id }),
        siteById(next),
        siteById(id),
        built(BUILD.update(requestCounts).set({ site: next }).where(and(eq(requestCounts.site, id), fragment`${requestCounts.day} IN (SELECT j.value FROM json_each(${days}) AS j)`, CHANGED))),
      ]);
      if (changed(updated)) return done(after);

      const refusal = unreachable(siteIn(before));
      if (refusal !== undefined) return refusal;
    }

    throw new Error(`no free site id in ${MINT_ATTEMPTS} tries`);
  }

  async trashSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    const trash = BUILD.update(sites).set({ trashed_at: signed.at }).where(and(eq(sites.id, id), eq(sites.trashed, 0)));
    const [updated, , after] = await this.#driver.batch([built(trash), auditOfSite(signed, "trash", id, {}), siteById(id)]);
    if (changed(updated)) return done(after);

    return unreachable(siteIn(after)) ?? { kind: "not_found" };
  }

  async restoreSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "not_in_trash">> {
    // An expiry that is not after the moment of the restore is dropped with it.
    const expiry = fragment<number | null>`CASE WHEN ${sites.expires_at} > ${signed.at} THEN ${sites.expires_at} END`;
    const restore = BUILD.update(sites).set({ trashed_at: null, expires_at: expiry }).where(and(eq(sites.id, id), eq(sites.trashed, 1)));
    const [updated, , after] = await this.#driver.batch([built(restore), auditOfSite(signed, "restore", id, {}), siteById(id)]);
    if (changed(updated)) return done(after);

    return { kind: siteIn(after) === undefined ? "not_found" : "not_in_trash" };
  }

  async deleteSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found">> {
    // The audit entry is written while the site is still there to name, and the delete only when it was.
    const entry = fragment`SELECT ${signed.at}, ${signed.by}, 'delete', ${sites.id}, ${sites.name}, '{}' FROM ${sites} WHERE ${sites.id} = ${id}`;
    const remove = BUILD.delete(sites).where(and(eq(sites.id, id), CHANGED));
    const [before, , deleted] = await this.#driver.batch([siteById(id), insertFrom(audit, AUDIT_COLUMNS, entry), built(remove)]);
    if (!changed(deleted)) return { kind: "not_found" };

    return done(before);
  }

  async listLeftovers(query: { readonly limit: number; readonly after?: SiteFolder }): Promise<LeftoversPage> {
    requirePage(query.limit);

    // One row more than the page shows whether another page follows.
    const page = BUILD.select({ folder: leftovers.folder }).from(leftovers).where(gt(leftovers.folder, query.after ?? "")).orderBy(asc(leftovers.folder)).limit(query.limit + 1);
    const [listed] = await this.#driver.batch([built(page)]);
    const folders = (listed?.rows ?? []).slice(0, query.limit).map((row) => v.parse(SITE_FOLDER, row.folder));
    const last = folders.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { folders };

    return { folders, next: last };
  }

  async forgetLeftover(folder: SiteFolder): Promise<void> {
    await this.#driver.batch([built(BUILD.delete(leftovers).where(eq(leftovers.folder, folder)))]);
  }

  async reserveVersion(id: SiteId): Promise<Reserved | Refused<"not_found" | "in_trash">> {
    const reserve = BUILD.update(sites).set({ next_version: fragment`${sites.next_version} + 1` }).where(and(eq(sites.id, id), eq(sites.trashed, 0)));
    const number = BUILD.select({ number: fragment<number>`${sites.next_version} - 1`.as("number") }).from(sites).where(eq(sites.id, id));
    const [updated, reserved, after] = await this.#driver.batch([built(reserve), built(number), siteById(id)]);
    if (changed(updated)) return { kind: "reserved", number: Number(reserved?.rows[0]?.number) };

    return unreachable(siteIn(after)) ?? { kind: "not_found" };
  }

  async addVersion(id: SiteId, version: NewVersion, signed: Signed): Promise<Published | Refused<"not_found" | "in_trash" | "stale_number">> {
    if (!Number.isSafeInteger(version.keep) || version.keep < 1) throw new RangeError(`a site keeps at least 1 version, not ${version.keep}`);

    requireCount("the size of a version in bytes", version.bytes);
    requireCount("the number of files of a version", version.files);

    // A version is kept only when its number was set aside and is above every kept one, so a slower, older publish never replaces a newer one.
    const above = fragment`${version.number} < ${sites.next_version} AND ${version.number} > (SELECT MAX(${versions.number}) FROM ${versions} WHERE ${versions.folder} = ${sites.folder})`;
    const entry = fragment`SELECT ${sites.folder}, ${version.number}, ${signed.at}, ${signed.by}, ${version.bytes}, ${version.files} FROM ${sites} WHERE ${sites.id} = ${id} AND ${sites.trashed} = 0 AND ${above}`;
    const [before, , updated, , , after] = await this.#driver.batch([
      siteById(id),
      insertFrom(versions, VERSION_COLUMNS, entry),
      built(BUILD.update(sites).set({ live_version: version.number, updated_at: signed.at }).where(and(eq(sites.id, id), CHANGED))),
      auditOfSite(signed, "publish", id, { version: version.number }),
      dropOldVersions(fragment`(SELECT ${sites.folder} FROM ${sites} WHERE ${sites.id} = ${id})`, version.keep),
      siteById(id),
    ]);
    if (!changed(updated)) return unreachable(siteIn(after)) ?? { kind: "stale_number" };

    const published = done(after);
    const kept = new Set(published.site.versions.map((entry) => entry.number));
    const dropped = (siteIn(before)?.versions ?? []).map((entry) => entry.number).filter((number) => !kept.has(number));

    return { ...published, dropped };
  }

  async setLiveVersion(
    id: SiteId,
    target: number | "previous",
    signed: Signed,
  ): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "no_such_version">> {
    // The audit entry names the version the site is at after the move.
    const entry = fragment`SELECT ${signed.at}, ${signed.by}, 'live_version', ${sites.id}, ${sites.name}, json_object('version', ${sites.live_version}) FROM ${sites} WHERE ${sites.id} = ${id} AND ${CHANGED}`;
    const [updated, , after] = await this.#driver.batch([moveLive(id, target, signed.at), insertFrom(audit, AUDIT_COLUMNS, entry), siteById(id)]);
    if (changed(updated)) return done(after);

    const site = siteIn(after);
    const refusal = unreachable(site);
    if (site === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    if (site.live_version === target) return { kind: "unchanged", site };

    return { kind: "no_such_version" };
  }

  async readTotals(): Promise<Totals> {
    const kept = { sites: totals.sites, trashed_sites: totals.trashed_sites, bytes: totals.bytes, files: totals.files };
    const [read] = await this.#driver.batch([built(BUILD.select(kept).from(totals).where(eq(totals.id, 1)))]);

    return totalsFromRow(read?.rows[0]);
  }

  async exportSites(query: { readonly limit: number; readonly after?: SiteId }): Promise<ExportPage> {
    requirePage(query.limit);

    // One row more than the page shows whether another page follows.
    const page = BUILD.select(SITE_FIELDS).from(sites).where(gt(sites.id, query.after ?? "")).orderBy(asc(sites.id)).limit(query.limit + 1);
    const [listed] = await this.#driver.batch([built(page)]);
    const listedSites = (listed?.rows ?? []).slice(0, query.limit).map(siteFromRow);
    const last = listedSites.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { sites: listedSites };

    return { sites: listedSites, next: last.id };
  }

  async importUploadAsSite(id: UploadId, site: Site, signed: Signed): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken" | "not_pending">> {
    const row = siteToRow(site);
    const nextVersion = Math.max(...row.versions.map((version) => version.number)) + 1;
    const columns = [
      sites.id,
      sites.name,
      sites.folder,
      sites.access,
      sites.public_name,
      sites.title,
      sites.search_engines,
      sites.embeddable,
      sites.expires_at,
      sites.live_version,
      sites.next_version,
      sites.owner,
      sites.created_at,
      sites.updated_at,
      sites.trashed_at,
      sites.page_title,
    ];
    const identity = fragment`${row.id}, ${row.name}, ${row.folder}, ${row.access}, ${row.public_name}, ${row.title}, ${row.search_engines}, ${row.embeddable}, ${row.expires_at}`;
    const values = fragment`${identity}, ${row.live_version}, ${nextVersion}, ${row.owner}, ${row.created_at}, ${row.updated_at}, ${row.trashed_at}, ${row.page_title}`;
    const folderIsFree = notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.folder, row.folder)));
    const free = and(isFree(row.id), folderIsFree, publicNameIsFree(row.public_name, row.id), isFirstPending(id, row.folder));
    // The live version is there already, made with the site, and takes its exported values.
    const exported = [versions.number, versions.published_at, versions.published_by, versions.bytes, versions.files];
    const listed = fragment.join(exported.map((column) => fragment`j.value ->> ${fragment.raw(`'${column.name}'`)}`), fragment`, `);
    const taken = fragment.join(exported.slice(1).map((column) => fragment`${bare(column)} = excluded.${bare(column)}`), fragment`, `);
    const kept = fragment`SELECT ${row.folder}, ${listed} FROM json_each(${JSON.stringify(row.versions)}) j WHERE ${CHANGED} ON CONFLICT (${bare(versions.folder)}, ${bare(versions.number)}) DO UPDATE SET ${taken}`;
    const idIsHeld = fragment`(EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.id} = ${row.id}) OR EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.public_name} = ${row.id}))`;
    const isHeld = fragment`SELECT ${idIsHeld} AS id_held, EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.folder} = ${row.folder}) AS folder_held`;

    // The upload is finished straight after the audit entry, so each statement up to the versions sees the one row the statement before it wrote.
    const results = await this.#driver.batch([
      insertFrom(sites, columns, fragment`SELECT ${values} WHERE ${free}`),
      auditOfSite(signed, "imported", row.id, { versions: row.versions.length }),
      finishUpload(id),
      insertFrom(versions, VERSION_COLUMNS, kept),
      written(isHeld),
      siteById(row.id),
      uploadById(id),
    ]);
    const [held, made, waiting] = results.slice(-3);
    if (changed(results[0])) return done(made);

    const begun = uploadIn(waiting);
    if (begun?.state !== "pending" || begun.folder !== row.folder || begun.number !== 1) return { kind: "not_pending" };

    if (held?.rows[0]?.id_held === 1) return { kind: "id_taken" };

    if (held?.rows[0]?.folder_held === 1) return { kind: "folder_taken" };

    return { kind: "name_taken" };
  }

  async addUpload(upload: NewUpload, room: UploadRoom): Promise<{ readonly kind: "done" } | Refused<"own_full" | "folder_full" | "total_full" | "sites_full" | "day_full">> {
    requireDay(room.day);
    const manifest = manifestToText(upload.manifest);
    const bytes = upload.manifest.reduce((sum, file) => sum + file.size, 0);
    const row = { ...upload, state: "pending", plan: JSON.stringify(upload.plan), bytes, files: upload.manifest.length, dropped: "[]" };
    const checked = uploadFromRow(row);
    const own = pendingOf(checked.owner);
    const folderBytes = bytesIn(checked.folder, room.staying);
    const dayFiles = fragment`(SELECT COALESCE(SUM(${declaredFiles.files}), 0) FROM ${declaredFiles} WHERE ${declaredFiles.day} = ${room.day})`;
    // What the upload is measured against is read before it is recorded, so a refusal can say which room is full.
    const held = fragment`SELECT ${checked.id} AS id, ${checked.number} AS number, ${own} AS own, ${folderBytes} AS folder_bytes, ${BYTES_HELD} AS total_bytes, ${SITES_HELD} AS sites`;
    const bytesFit = fragment`${folderBytes} + ${checked.bytes} <= ${room.folderBytes} AND ${BYTES_HELD} + ${checked.bytes} <= ${room.totalBytes}`;
    const fits = fragment`${own} < ${room.own} AND ${bytesFit} AND (${room.sites} IS NULL OR ${SITES_HELD} < ${room.sites}) AND ${dayFiles} + ${checked.files} <= ${room.dayFiles}`;
    const columns = [uploads.id, uploads.folder, uploads.number, uploads.owner, uploads.plan, uploads.manifest, uploads.bytes, uploads.files, uploads.created_at];
    const record = fragment`SELECT ${checked.id}, ${checked.folder}, ${checked.number}, ${checked.owner}, ${row.plan}, ${manifest}, ${checked.bytes}, ${checked.files}, ${checked.created_at} WHERE ${fits}`;
    const files = bare(declaredFiles.files);
    const counted = fragment`SELECT ${room.day}, ${checked.files} WHERE ${CHANGED} ON CONFLICT (${bare(declaredFiles.day)}) DO UPDATE SET ${files} = ${files} + excluded.${files}`;

    const [before, , inserted] = await this.#driver.batch([
      written(held),
      // Yesterday's count stays: an upload that began just before midnight is still counted against it.
      built(BUILD.delete(declaredFiles).where(fragment`${declaredFiles.day} < date(${room.day}, '-1 day')`)),
      insertFrom(uploads, columns, record),
      insertFrom(declaredFiles, [declaredFiles.day, declaredFiles.files], counted),
    ]);
    if (changed(inserted)) return { kind: "done" };

    const measured = before?.rows[0];
    if (Number(measured?.own) >= room.own) return { kind: "own_full" };

    if (Number(measured?.folder_bytes) + checked.bytes > room.folderBytes) return { kind: "folder_full" };

    if (Number(measured?.total_bytes) + checked.bytes > room.totalBytes) return { kind: "total_full" };

    return { kind: room.sites !== null && Number(measured?.sites) >= room.sites ? "sites_full" : "day_full" };
  }

  async getUpload(id: UploadId): Promise<{ readonly upload: Upload; readonly manifest: readonly ManifestFile[] } | undefined> {
    const [found] = await this.#driver.batch([built(BUILD.select({ ...UPLOAD_FIELDS, manifest: uploads.manifest }).from(uploads).where(eq(uploads.id, id)))]);
    const upload = uploadIn(found);
    if (upload === undefined) return undefined;

    return { upload, manifest: manifestFromText(String(found?.rows[0]?.manifest)) };
  }

  async getUploadFile(id: UploadId, path: string): Promise<{ readonly upload: Upload; readonly file: ManifestFile | undefined } | undefined> {
    // The engine reads one value out of the row: it walks no entry of the manifest.
    const file = fragment<string | null>`json_extract(${uploads.manifest}, '$.' || ${manifestKey(path)})`.as("file");
    const [found] = await this.#driver.batch([built(BUILD.select({ ...UPLOAD_FIELDS, file }).from(uploads).where(eq(uploads.id, id)))]);
    const upload = uploadIn(found);
    if (upload === undefined) return undefined;

    const stored = found?.rows[0]?.file;
    if (typeof stored !== "string") return { upload, file: undefined };

    return { upload, file: fileUnderKey(stored, path) };
  }

  publishUploadAsSite(id: UploadId, draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken" | "not_pending">> {
    return this.#insertSite(draft, signed, id);
  }

  async publishUploadAsVersion(
    id: UploadId,
    version: UploadedVersion,
    signed: Signed,
  ): Promise<Published | Refused<"not_found" | "in_trash" | "name_taken" | "stale_number" | "not_pending">> {
    if (!Number.isSafeInteger(version.keep) || version.keep < 1) throw new RangeError(`a site keeps at least 1 version, not ${version.keep}`);

    const access = version.access?.access ?? null;
    const publicName = version.access === undefined ? null : publicNameOf(version.access);
    const settings = [...this.#accessWith(id, version.access, signed), ...this.#detailsWith(id, { access, publicName, details: version.details }, signed)];
    const inFolder = fragment`${sites.folder} = ${folderOf(id)}`;
    // The version takes the size its upload declared, only while the upload can be published and its site has the access asked with it.
    const publishable = fragment`${AN_UPLOAD.id} = ${id} AND ${hasAccess(id, access, publicName)} AND ${canPublish(id)}`;
    const uploaded = fragment`SELECT ${AN_UPLOAD.folder}, ${AN_UPLOAD.number}, ${signed.at}, ${signed.by}, ${AN_UPLOAD.bytes}, ${AN_UPLOAD.files} FROM ${uploads} ${AN_UPLOAD} WHERE ${publishable}`;
    const number = fragment<number>`(SELECT ${uploads.number} FROM ${uploads} WHERE ${uploads.id} = ${id})`;
    const entry = fragment`SELECT ${signed.at}, ${signed.by}, 'publish', ${sites.id}, ${sites.name}, json_object('version', ${sites.live_version}) FROM ${sites} WHERE ${inFolder} AND ${CHANGED}`;
    // The upload is finished with the versions beyond the highest kept, which the statement after it drops.
    const highest = fragment`(SELECT ${A_KEPT_VERSION.number} FROM ${versions} ${A_KEPT_VERSION} WHERE ${A_KEPT_VERSION.folder} = ${uploads.folder} ORDER BY ${A_KEPT_VERSION.number} DESC LIMIT ${version.keep})`;
    const dropped = fragment<string>`(SELECT json_group_array(${A_VERSION.number}) FROM ${versions} ${A_VERSION} WHERE ${A_VERSION.folder} = ${uploads.folder} AND ${A_VERSION.number} NOT IN ${highest})`;
    const isHeld = fragment`SELECT (EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.public_name} = ${publicName} AND ${sites.folder} <> ${folderOf(id)}) OR EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.id} = ${publicName})) AS held`;
    const results = await this.#driver.batch([
      ...settings,
      insertFrom(versions, VERSION_COLUMNS, uploaded),
      built(BUILD.update(sites).set({ live_version: number, page_title: version.page_title ?? null, updated_at: signed.at }).where(and(inFolder, CHANGED))),
      insertFrom(audit, AUDIT_COLUMNS, entry),
      built(BUILD.update(uploads).set({ state: "finished", manifest: "{}", dropped }).where(and(eq(uploads.id, id), CHANGED))),
      dropOldVersions(folderOf(id), version.keep),
      sitesWhere(inFolder),
      uploadById(id),
      written(isHeld),
    ]);
    const [inserted, , , , , after, finished, held] = results.slice(settings.length);
    const upload = uploadIn(finished);
    if (changed(inserted) && upload !== undefined) return { ...done(after), dropped: upload.dropped };

    if (upload?.state !== "pending") return { kind: "not_pending" };

    const refusal = unreachable(siteIn(after));
    if (refusal !== undefined) return refusal;

    return { kind: held?.rows[0]?.held === 1 ? "name_taken" : "stale_number" };
  }

  async setUploadDropped(id: UploadId, dropped: readonly number[]): Promise<void> {
    const finished = and(eq(uploads.id, id), eq(uploads.state, "finished"));
    await this.#driver.batch([built(BUILD.update(uploads).set({ dropped: JSON.stringify(dropped) }).where(finished))]);
  }

  async abandonUpload(id: UploadId): Promise<boolean> {
    const pending = and(eq(uploads.id, id), eq(uploads.state, "pending"));
    const [abandoned] = await this.#driver.batch([built(BUILD.update(uploads).set({ state: "abandoned", manifest: "{}" }).where(pending))]);

    return changed(abandoned);
  }

  async removeUpload(id: UploadId): Promise<boolean> {
    const [removed] = await this.#driver.batch([built(BUILD.delete(uploads).where(and(eq(uploads.id, id), ne(uploads.state, "pending"))))]);

    return changed(removed);
  }

  async listUploads(query: { readonly before: number; readonly limit: number; readonly after?: { readonly created_at: number; readonly id: UploadId } }): Promise<UploadsPage> {
    requirePage(query.limit);

    // One row more than the page shows whether another page follows.
    const beyond = fragment`(${uploads.created_at}, ${uploads.id}) > (${query.after?.created_at ?? -1}, ${query.after?.id ?? ""})`;
    const page = BUILD.select(UPLOAD_FIELDS).from(uploads).where(and(lt(uploads.created_at, query.before), beyond)).orderBy(asc(uploads.created_at), asc(uploads.id)).limit(query.limit + 1);
    const [listed] = await this.#driver.batch([built(page)]);
    const listedUploads = (listed?.rows ?? []).slice(0, query.limit).map(uploadFromRow);
    const last = listedUploads.at(-1);
    if (last === undefined || (listed?.rows.length ?? 0) <= query.limit) return { uploads: listedUploads };

    return { uploads: listedUploads, next: { created_at: last.created_at, id: last.id } };
  }

  async addToken(token: TokenRecord, signed: Signed): Promise<{ readonly kind: "done" } | Refused<"id_taken">> {
    const expires = token.scope === "admin" ? token.expiresAt : null;
    const [inserted] = await this.#driver.batch([
      sql(INSERT_TOKEN, token.id, token.hash, token.scope, token.note, token.createdAt, expires),
      auditPlain(signed, "token_added", { token: token.id, scope: token.scope, note: token.note }),
    ]);

    return { kind: changed(inserted) ? "done" : "id_taken" };
  }

  async getToken(id: TokenId): Promise<TokenRecord | undefined> {
    const [found] = await this.#driver.batch([sql(`${SELECT_TOKEN} WHERE id = ?1`, id)]);
    const row = found?.rows[0];

    return row === undefined ? undefined : tokenFromRow(row);
  }

  async listTokens(): Promise<readonly TokenRecord[]> {
    const [listed] = await this.#driver.batch([sql(`${SELECT_TOKEN} ORDER BY created_at DESC, id DESC`)]);

    return (listed?.rows ?? []).map(tokenFromRow);
  }

  async revokeToken(id: TokenId, signed: Signed): Promise<{ readonly kind: "done"; readonly token: TokenRecord } | Refused<"not_found">> {
    const [before, , deleted] = await this.#driver.batch([
      sql(`${SELECT_TOKEN} WHERE id = ?1`, id),
      sql(AUDIT_REVOKE, signed.at, signed.by, id),
      sql(DELETE_TOKEN, id),
    ]);
    const row = before?.rows[0];
    if (!changed(deleted) || row === undefined) return { kind: "not_found" };

    return { kind: "done", token: tokenFromRow(row) };
  }

  async addComputerLogin(login: PendingLogin, room: LoginRoom): Promise<{ readonly kind: "done" } | Refused<"taken">> {
    const [, , inserted] = await this.#driver.batch([
      sql(MAKE_ROOM_OF_VISITOR, login.id, login.code, login.createdAt, login.visitor, room.perVisitor - 1),
      sql(MAKE_ROOM_OF_ALL, login.id, login.code, login.createdAt, room.all),
      sql(INSERT_LOGIN, login.id, login.code, login.hash, login.scope, login.computer, login.visitor, login.createdAt, login.expiresAt),
    ]);

    return { kind: changed(inserted) ? "done" : "taken" };
  }

  async getComputerLogin(id: LoginId): Promise<ComputerLogin | undefined> {
    const [found] = await this.#driver.batch([sql(`${SELECT_LOGIN} WHERE id = ?1`, id)]);

    return loginIn(found);
  }

  async findComputerLogin(code: UserCode): Promise<ComputerLogin | undefined> {
    const [found] = await this.#driver.batch([sql(`${SELECT_LOGIN} WHERE code = ?1`, code)]);

    return loginIn(found);
  }

  async listWaitingComputerLogins(now: number): Promise<readonly PendingLogin[]> {
    const [listed] = await this.#driver.batch([sql(SELECT_WAITING_LOGINS, now)]);

    return (listed?.rows ?? []).map(computerLoginFromRow).filter((login) => login.state === "pending");
  }

  async decideComputerLogin(code: UserCode, decision: LoginDecision): Promise<{ readonly kind: "done"; readonly login: ComputerLogin } | Refused<"not_pending">> {
    const [updated, , after] = await this.#driver.batch([
      sql(DECIDE_LOGIN, code, decision.state, decision.by, decision.at, decision.asPublisher === true ? 1 : 0),
      sql(AUDIT_LOGIN, decision.at, decision.by, decision.state === "allowed" ? "login_allowed" : "login_denied", code),
      sql(`${SELECT_LOGIN} WHERE code = ?1`, code),
    ]);
    const login = loginIn(after);
    if (!changed(updated) || login === undefined) return { kind: "not_pending" };

    return { kind: "done", login };
  }

  async redeemComputerLogin(id: LoginId, token: TokenRecord): Promise<{ readonly kind: "done" } | Refused<"not_allowed">> {
    const expires = token.scope === "admin" ? token.expiresAt : null;
    const detail = JSON.stringify({ token: token.id, scope: token.scope, note: token.note });
    const [inserted] = await this.#driver.batch([
      sql(INSERT_TOKEN_OF_LOGIN, id, token.id, token.hash, token.note, token.createdAt, expires, token.scope),
      sql(AUDIT_TOKEN_OF_LOGIN, token.createdAt, id, detail),
      sql(DELETE_REDEEMED_LOGIN, id),
    ]);

    return { kind: changed(inserted) ? "done" : "not_allowed" };
  }

  async sweepComputerLogins(now: number): Promise<number> {
    const [removed] = await this.#driver.batch([sql(DELETE_OLD_LOGINS, now)]);

    return removed?.changes ?? 0;
  }

  async readSweepPlace(): Promise<SweepPlace | undefined> {
    const [read] = await this.#driver.batch([sql(READ_SWEEP_PLACE)]);

    return placeIn(read);
  }

  async keepSweepPlace(place: SweepPlace | undefined): Promise<void> {
    const kept = place === undefined ? sql(FORGET_SWEEP_PLACE) : sql(KEEP_SWEEP_PLACE, JSON.stringify(v.parse(SWEEP_PLACE, place)));

    await this.#driver.batch([kept]);
  }

  async readUpdateCheck(): Promise<UpdateCheck | undefined> {
    const [read] = await this.#driver.batch([sql(READ_UPDATE_CHECK)]);

    return updateCheckIn(read);
  }

  async keepUpdateCheck(check: UpdateCheck): Promise<void> {
    const { checked_at, news } = v.parse(UPDATE_CHECK, check);

    await this.#driver.batch([sql(KEEP_UPDATE_CHECK, checked_at, news === null ? null : JSON.stringify(news))]);
  }

  async readSettings(): Promise<SettingValues | undefined> {
    const [read] = await this.#driver.batch([sql(READ_SETTINGS)]);

    return settingsIn(read);
  }

  async initSettings(values: SettingValues, signed: Signed): Promise<{ readonly kind: "done" | "already_set"; readonly values: SettingValues }> {
    const checked = v.parse(SETTING_VALUES, values);
    const [inserted, , read] = await this.#driver.batch([
      sql(INSERT_SETTINGS, JSON.stringify(checked), signed.at),
      auditPlain(signed, "settings_set", {}),
      sql(READ_SETTINGS),
    ]);
    const stored = settingsIn(read);
    if (stored === undefined) throw new Error("the settings were stored and are not there to read");

    return { kind: changed(inserted) ? "done" : "already_set", values: stored };
  }

  async changeSettings(
    changes: Partial<SettingValues>,
    signed: Signed,
  ): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up">> {
    const checked = v.parse(SETTING_CHANGES, changes);
    const [patched, , read] = await this.#driver.batch([
      sql(PATCH_SETTINGS, JSON.stringify(checked), signed.at),
      auditPlain(signed, "settings_changed", checked),
      sql(READ_SETTINGS),
    ]);
    const values = settingsIn(read);
    if (values === undefined) return { kind: "not_set_up" };

    return { kind: changed(patched) ? "done" : "unchanged", values };
  }

  async readSigningKey(): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const [read] = await this.#driver.batch([sql(READ_SIGNING_KEY)]);

    return signingKeyIn(read);
  }

  async ensureSigningKey(fresh: Uint8Array, at: number): Promise<SigningKey> {
    const text = signingKeyToText(fresh);
    const stored = await this.readSigningKey();
    if (stored !== undefined) return { kind: "kept", key: stored };

    const [inserted, read] = await this.#driver.batch([sql(INSERT_SIGNING_KEY, text, at), sql(READ_SIGNING_KEY)]);
    const key = signingKeyIn(read);
    if (key === undefined) throw new Error("the signing key was stored and is not there to read");

    return { kind: changed(inserted) ? "created" : "kept", key };
  }

  async rotateSigningKey(fresh: Uint8Array, signed: Signed): Promise<void> {
    await this.#driver.batch([sql(REPLACE_SIGNING_KEY, signingKeyToText(fresh), signed.at), auditPlain(signed, "signed_everyone_out", {})]);
  }

  async readUpdateAddress(): Promise<UpdateAddress | undefined> {
    const [read] = await this.#driver.batch([sql(READ_UPDATE_ADDRESS)]);
    const row = read?.rows[0];

    return row === undefined ? undefined : updateAddressFromRow(row);
  }

  async keepUpdateAddress(address: string, signed: Signed): Promise<void> {
    await this.#driver.batch([sql(KEEP_UPDATE_ADDRESS, address, signed.at), auditPlain(signed, "update_address_set", {})]);
  }

  async forgetUpdateAddress(signed: Signed): Promise<{ readonly kind: "done" | "unchanged" }> {
    const [removed] = await this.#driver.batch([sql(FORGET_UPDATE_ADDRESS), auditPlain(signed, "update_address_removed", {})]);

    return { kind: changed(removed) ? "done" : "unchanged" };
  }

  async appendAudit(note: AuditNote, signed: Signed): Promise<void> {
    await this.#driver.batch([sql(AUDIT_NOTE, signed.at, signed.by, note.action, note.site?.id ?? null, note.site?.name ?? null, JSON.stringify(note.detail))]);
  }

  async hasLoggedIn(): Promise<boolean> {
    const [read] = await this.#driver.batch([sql(HAS_LOGIN)]);

    return read?.rows[0]?.found === 1;
  }

  async listAudit(query: AuditQuery): Promise<readonly AuditEntry[]> {
    requirePage(query.limit);
    const conditions = [
      lt(audit.seq, query.before ?? NEWEST),
      query.actions === undefined ? undefined : fragment`${audit.action} IN (SELECT value FROM json_each(${JSON.stringify(query.actions)}))`,
      query.site === undefined ? undefined : fragment`instr(${audit.site_name}, ${query.site}) > 0`,
    ];
    const page = BUILD.select().from(audit).where(and(...conditions)).orderBy(desc(audit.seq)).limit(query.limit);
    const [listed] = await this.#driver.batch([built(page)]);

    return (listed?.rows ?? []).map(auditFromRow);
  }

  async addRequests(counted: CountedRequests): Promise<RequestCounts> {
    requireDay(counted.day);
    if (!Number.isSafeInteger(counted.requests) || counted.requests < 1) throw new RangeError(`requests are counted in whole numbers from 1, not ${counted.requests}`);

    const views = counted.views ?? 0;
    if (!Number.isSafeInteger(views) || views < 0 || views > counted.requests) throw new RangeError(`views are counted in whole numbers from 0 to the requests, not ${views}`);

    const [, site, all] = await this.#driver.batch([
      sql(DROP_EARLIER_DAYS, viewDays(counted.day)[0] ?? counted.day),
      sql(ADD_REQUESTS, counted.day, counted.site, counted.requests, views),
      sql(ADD_REQUESTS, counted.day, ALL_SITES, counted.requests, views),
    ]);

    return { site: requestsIn(site), all: requestsIn(all) };
  }

  async readViews(sites: readonly SiteId[], day: string): Promise<ReadonlyMap<SiteId, SiteViews>> {
    requireDay(day);
    if (sites.length > MOST_VIEWED_SITES) throw new RangeError(`the views of at most ${MOST_VIEWED_SITES} sites are read at once, not of ${sites.length}`);

    const views = new Map<SiteId, SiteViews>(sites.map((site) => [site, { today: 0, week: 0 }]));
    if (sites.length === 0) return views;

    // A site named twice is read once: its rows would be summed once for each naming.
    const [read] = await this.#driver.batch([sql(READ_VIEWS, JSON.stringify(viewDays(day)), JSON.stringify([...views.keys()]), day)]);
    for (const row of read?.rows ?? []) views.set(row.site as SiteId, { today: Number(row.today), week: Number(row.week) });

    return views;
  }

  async readRequests(day: string, site?: SiteId): Promise<RequestCounts> {
    requireDay(day);
    const ofSite = site === undefined ? [] : [sql(READ_REQUESTS, day, site)];
    const read = await this.#driver.batch([sql(READ_REQUESTS, day, ALL_SITES), ...ofSite]);

    return { site: requestsIn(read[1]), all: requestsIn(read[0]) };
  }

  /** The statements that set the access asked with an upload, and their audit entry; none when no access is asked. */
  #accessWith(id: UploadId, access: SiteAccess | undefined, signed: Signed): Statement[] {
    if (access === undefined) return [];

    const publicName = publicNameOf(access);
    // A public name is free for a site when no site in another folder has it, and none has it as its id.
    const freeFor = (name: PublicName): SQL | undefined =>
      and(notExists(BUILD.select(ONE).from(OTHER).where(and(eq(OTHER.public_name, name), ne(OTHER.folder, sites.folder)))), notExists(BUILD.select(ONE).from(OTHER).where(eq(OTHER.id, name))));
    const differs = or(ne(sites.access, access.access), fragment`${sites.public_name} IS NOT ${publicName}`);
    const asked = and(fragment`${sites.folder} = ${folderOf(id)}`, differs, publicName === null ? undefined : freeFor(publicName), canPublish(id));

    return [
      built(BUILD.update(sites).set({ access: access.access, public_name: publicName }).where(asked)),
      auditWithUpload(signed, "access", id, { access: access.access, public_name: publicName }),
    ];
  }

  /** The statements that set the details asked with an upload, only once its site has the access asked with it, and their audit entry; none when no detail is asked. */
  #detailsWith(
    id: UploadId,
    asked: { readonly access: string | null; readonly publicName: string | null; readonly details: SiteDetails },
    signed: Signed,
  ): Statement[] {
    const given = v.parse(SITE_DETAILS, asked.details);
    const stored = storedDetails(given);
    const columns = Object.keys(stored) as (keyof typeof stored)[];
    if (columns.length === 0) return [];

    const differs = or(...columns.map((column) => fragment`${sites[column]} IS NOT ${stored[column] ?? null}`));
    const ready = and(fragment`${sites.folder} = ${folderOf(id)}`, differs, hasAccess(id, asked.access, asked.publicName), canPublish(id));

    return [built(BUILD.update(sites).set(stored).where(ready)), auditWithUpload(signed, "details", id, given)];
  }

  /** Make a site under a fresh id; with `upload`, only while that upload is pending, and marking it finished in the same step. */
  async #insertSite(draft: NewSite, signed: Signed, upload?: UploadId): Promise<Done | Refused<"name_taken" | "not_pending">> {
    const site = v.parse(NEW_SITE, draft);
    const publicName = publicNameOf(site);
    const detail = { access: site.access, public_name: publicName };
    // The first version, which the schema made with the site, is given its size only when the site was made.
    const size = BUILD.update(versions).set({ bytes: site.bytes, files: site.files }).where(and(eq(versions.folder, site.folder), eq(versions.number, 1), CHANGED));
    const held = fragment`SELECT (EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.public_name} = ${publicName}) OR EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.id} = ${publicName})) AS held`;

    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const id = this.#mintId();
      const [inserted, , , , taken, made, waiting] = await this.#driver.batch([
        insertSite(id, site, signed, upload),
        built(size),
        auditOfSite(signed, "create", id, detail),
        finishUpload(upload ?? null),
        written(held),
        siteById(id),
        uploadById(upload ?? null),
      ]);
      if (changed(inserted)) return done(made);

      if (upload !== undefined && uploadIn(waiting)?.state !== "pending") return { kind: "not_pending" };

      if (publicName !== null && taken?.rows[0]?.held === 1) return { kind: "name_taken" };
    }

    throw new Error(`no free site id in ${MINT_ATTEMPTS} tries`);
  }

  async #unchanged(id: SiteId): Promise<Unchanged | Refused<"not_found" | "in_trash">> {
    const [found] = await this.#driver.batch([siteById(id)]);

    return this.#unchangedIn(found);
  }

  #unchangedIn(result: StatementResult | undefined): Unchanged | Refused<"not_found" | "in_trash"> {
    const site = siteIn(result);
    const refusal = unreachable(site);
    if (site === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    return { kind: "unchanged", site };
  }
}
