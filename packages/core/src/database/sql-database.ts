// The database interface over SQLite. Every statement poplin runs outside a migration step is built in this file or in a `-statements` file beside it, from the schema `schema.ts` declares, and every row leaves it as a checked value.
//
// A change is one batch: the statement that changes a row carries its own condition, and each statement after it runs only when the one before it changed a row.
// So a change and its audit entry are kept together or not at all, and nothing is decided from an earlier read.

import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, notExists, or, type SQL, sql as fragment } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import type { ComputerLogin, LoginId, PendingLogin, UserCode } from "../auth/computer-logins";
import type { Login } from "../auth/logins";
import type { TokenId, TokenRecord } from "../auth/tokens";
import type { PublicName } from "../names/names";
import { type AuditAction, type AuditEntry, auditFromRow, HISTORY_KEPT_MS } from "../records/audit";
import type { CarriedRules, CarriedUsers, DomainCheck, RememberedCheck } from "../records/domain-check";
import { computerLoginFromRow } from "../records/computer-login";
import type { Mend, Problem } from "../records/problem";
import { LOGIN, SITE_ID } from "../records/fields";
import { SETTING_CHANGES, SETTING_VALUES, type SettingValues } from "../records/settings";
import { visitorKeyFromRow, visitorKeyToText } from "../records/secret";
import { NEW_SITE, SITE_DETAILS, SITE_FOLDER, type Site, type SiteAccess, type SiteFolder, siteFromRow, siteToRow } from "../records/site";
import { SWEEP_PLACE, type SweepPlace } from "../records/sweep-place";
import { AUTO_START, type AutoStart, UPDATE_CHECK, type UpdateCheck } from "../records/update";
import { type Totals, totalsFromRow } from "../records/sizes";
import { mintSiteId, type SiteId } from "../sites/ids";
import { endedTokenFromRow, tokenFromRow } from "../records/token";
import { type ManifestFile, type Upload, type UploadId, uploadFromRow } from "../records/upload";
import type { VersionContents } from "../records/version-contents";
import { type CountedViews, dayOf, daysUpTo, KEPT_DAYS, MOST_SITES_COMPARED, type SiteViews, viewDays, weeksUpTo } from "../records/views";
import { auditCountAsked, auditCountIn, auditEndsAsked, auditListAsked, auditPartEndAsked, auditPartEndIn, auditSearchAsked, auditStopIn, auditTrimmed, everLoggedInAsked, namedAuditIn } from "./audit-reads";
import type {
  AuditCount,
  AuditCountQuery,
  AuditFound,
  AuditPartQuery,
  AuditQuery,
  AuditSearch,
  NamedAuditEntry,
  NamedAuditFound,
  Address,
  AuditNote,
  CountedRequests,
  DayUse,
  Database,
  Done,
  DueSites,
  ExportPage,
  FrameRecords,
  LeftoversPage,
  LoginDecision,
  LoginRoom,
  MadeWith,
  NewSite,
  NewUpload,
  Published,
  Refused,
  RequestCounts,
  RowsUsed,
  Reserved,
  ServedSite,
  ServedAlso,
  ServedLookup,
  SettingsAndKey,
  SettingsAndUpdateCheck,
  SettingsAndSite,
  ShownSite,
  ShownSitesPage,
  Signed,
  VisitorKey,
  SiteDetails,
  SiteNow,
  SiteNamed,
  SitesPage,
  SitesQuery,
  SitesShown,
  SweepStart,
  Taken,
  TokenStates,
  Unchanged,
  UploadedVersion,
  UploadRoom,
  UploadsPage,
} from "./database";
import { domainCheckAsked, domainCheckIn, domainCheckKept, rulesCarried, rulesClaimed, rulesReplaced, usersCarried, usersChanged, usersClaimed, usersReplaced, waitingMark } from "./domain-check";
import type { SqlDriver, Statement, StatementResult } from "./driver";
import { type ProblemNote, problemNoted, problemsAsked, problemsEnded, problemsForgotten, problemsIn } from "./problems";
import { contentsValues, servedIn, versionsWithContents } from "./served";
import { filesUnderKeys, fileUnderKey, MANIFEST_KEY, manifestFromText, manifestKey, manifestToText } from "./manifest";
import {
  audit,
  declaredFiles,
  earlierIds,
  leftovers,
  logins,
  requestCounts,
  secrets,
  settings,
  sites,
  sweepPlace,
  tokens,
  totals,
  updateCheck,
  uploads,
  versions,
} from "./schema";
import {
  ENDED_TOKEN_FIELDS,
  NAMED_TOKEN,
  NOT_REMOVED,
  TOKEN_COLUMNS,
  TOKEN_FIELDS,
  endedTokensTrimmed,
  isNewLogin,
  loginsWhere,
  makeRoomOfAll,
  makeRoomOfVisitor,
  tokenById,
  tokenNames,
  USER_TOKENS,
  endSignerLeftOut,
  endTokensOfDropped,
  endTokensOfRemoved,
  isUser,
  signerStands,
  userBehind,
  userTokenCounts,
  worksAt,
} from "./login-statements";
import {
  A_KEPT_VERSION,
  LATER_FIELDS,
  LATER_SITE,
  NAMED_FIELDS,
  NAMED_SITE,
  OTHER,
  SHOWN_BESIDE,
  SITE_FIELDS,
  VERSION_COLUMNS,
  dropOldVersions,
  insertSite,
  isFirstPending,
  isFree,
  keepEarlierId,
  moveLive,
  pageAsked,
  pageIn,
  pageWithBeside,
  publicNameIsFree,
  publicNameOf,
  servedSite,
  setAccess,
  siteById,
  sitesWhere,
  storedDetails,
} from "./site-statements";
import { BUILD, CHANGED, ONE, bare, built, insertFrom, qualified, written } from "./statements";
import {
  AN_UPLOAD,
  A_VERSION,
  BYTES_HELD,
  SITES_HELD,
  UPLOAD_FIELDS,
  addWrites,
  bytesIn,
  canPublish,
  dropEarlierDays,
  finishUpload,
  folderOf,
  hasAccess,
  pendingOf,
  uploadById,
  writesOf,
} from "./upload-statements";
import { ALL_SITES, dailyViewsAsked, dailyViewsIn, sumsDroppedBefore, sumsMoved, viewsSummed, weeklyViewsAsked, weeklyViewsIn } from "./view-statements";

/** How many ids are tried for one site before giving up; an id is about 62 random bits, so a second try is already a rare event. */
const MINT_ATTEMPTS = 5;

/** The most keys of a manifest one column of a statement reads: a function of the engine takes 32 arguments at most. */
const KEYS_PER_LIST = 32;

/** The most rows one page of a listing holds. */
const MAX_PAGE = 100;

/** The most entries one reading of the audit log holds: a file of the log is read in pages of this many. */
const MAX_AUDIT_PAGE = 1000;

/** Where a page of the audit log starts when no page came before it: past the newest entry, and ahead of the oldest. */
const AUDIT_START = { desc: Number.MAX_SAFE_INTEGER, asc: 0 } as const;

/** The columns an audit entry is written with; `seq` is the engine's to give. */
const AUDIT_COLUMNS = [audit.at, audit.actor, audit.action, audit.site_id, audit.site_name, audit.detail];

/** The columns an audit entry of a change to no site is written with. */
const PLAIN_AUDIT_COLUMNS = [audit.at, audit.actor, audit.action, audit.detail];

/** The largest whole number the engine counts with exactly: the bound of a day on an install that has stored no settings. */
const NO_BOUND = Number.MAX_SAFE_INTEGER;

/** The `request_counts` table as `c`, joined to the days and the sites a read of views names. */
const A_COUNT = alias(requestCounts, "c");

/** The settings, as JSON text. */
const READ_SETTINGS = built(BUILD.select({ value: settings.value }).from(settings).where(eq(settings.id, 1)));

/** The visitor key, as hex text. */
const READ_VISITOR_KEY = built(BUILD.select({ value: secrets.value }).from(secrets).where(eq(secrets.name, "visitor_key")));

/** The last asking for a newer version, its news and its start as JSON text. */
const READ_UPDATE_CHECK = built(
  BUILD.select({ checked_at: updateCheck.checked_at, news: updateCheck.news, seen_at: updateCheck.seen_at, auto: updateCheck.auto }).from(updateCheck).where(eq(updateCheck.id, 1)),
);

/** Where the scheduled sweep's walk stopped, as JSON text. */
const READ_SWEEP_PLACE = built(BUILD.select({ place: sweepPlace.place }).from(sweepPlace).where(eq(sweepPlace.id, 1)));

/** The form of a day: a date such as `2026-11-13`, which sorts as text in the order of time. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** No rows of the database: what a site's own count holds, and a count that names none. */
const NO_ROWS: RowsUsed = { read: 0, written: 0 };

/** The most sites one read of names or of views takes: a page of a listing or of the log. */
const MOST_SITES_ASKED = 100;

/** How many tokens one statement names: a database binds only so many values to one. */
const TOKENS_A_STATEMENT = 100;

/** The audit entry of a change to the site now at the given id, written only when the statement before it changed a row. */
function auditOfSite(signed: Signed, action: AuditAction, id: SiteId, detail: Readonly<Record<string, unknown>>): Statement {
  const entry = fragment`SELECT ${signed.at}, ${signed.by}, ${action}, ${sites.id}, ${sites.name}, ${JSON.stringify(detail)} FROM ${sites} WHERE ${sites.id} = ${id} AND ${CHANGED}`;

  return insertFrom(audit, AUDIT_COLUMNS, entry);
}

/** The audit entry of a change made with an upload to its site, written only when the statement before it changed a row. */
function auditWithUpload(signed: Signed, action: AuditAction, upload: UploadId, detail: Readonly<Record<string, unknown>>): Statement {
  const entry = fragment`SELECT ${signed.at}, ${signed.by}, ${action}, ${sites.id}, ${sites.name}, ${JSON.stringify(detail)} FROM ${sites} WHERE ${sites.folder} = ${folderOf(upload)} AND ${CHANGED}`;

  return insertFrom(audit, AUDIT_COLUMNS, entry);
}

/** The audit entry of a change to no site, written only when the statement before it changed a row. */
function auditPlain(signed: Pick<Signed, "by" | "at">, action: AuditAction, detail: Readonly<Record<string, unknown>>): Statement {
  return insertFrom(audit, PLAIN_AUDIT_COLUMNS, fragment`SELECT ${signed.at}, ${signed.by}, ${action}, ${JSON.stringify(detail)} WHERE ${CHANGED}`);
}

/** Whether an email is one of the stored logins, for a statement on the settings row. */
function isStoredLogin(email: string): SQL {
  return fragment`EXISTS (SELECT 1 FROM json_each(${settings.value}, '$.logins') AS j WHERE j.value = ${email})`;
}

/** The settings, and whether who signs a change of them still stands. */
function settingsAndSigner(signed: Signed): Statement {
  return built(BUILD.select({ value: settings.value, stands: fragment<number>`${signerStands(signed)}`.as("stands") }).from(settings).where(eq(settings.id, 1)));
}

/** Whether the settings a change comes to keep `auto_update` on only beside `update_check`. It reads the stored settings by itself, so a statement on any table can wait on it. */
function updatePairKept(patched: SQL): SQL {
  const alone = fragment`json_extract(${patched}, '$.auto_update') = 1 AND json_extract(${patched}, '$.update_check') = 0`;

  return fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1 AND NOT (${alone}))`;
}

/** Whether the read of `settingsAndSigner` found a signer who no longer stands. */
function signerGone(read: StatementResult | undefined): boolean {
  return read?.rows[0]?.stands !== 1;
}

/** The logins of one list that another does not hold, as a JSON array. Each list is a `json_each` of an array, which the engine walks in the array's order. */
function loginsApart(held: SQL, missing: SQL): SQL {
  return fragment`(SELECT json_group_array(one.value) FROM ${held} AS one WHERE one.value NOT IN (SELECT value FROM ${missing}))`;
}

/**
 * The audit entry of a change of the settings, with the values it sets. New logins are held with who they add and who they leave out, as `added` and `removed`.
 * It goes before the change in a batch, under the change's own condition: it reads the logins still stored.
 */
function auditOfSettings(signed: Signed, changes: Partial<SettingValues>, lands: SQL | undefined): Statement {
  const [stored, given] = [fragment`json_each(${settings.value}, '$.logins')`, fragment`json_each(${JSON.stringify(changes.logins ?? [])})`];
  const users = fragment`json_set(${JSON.stringify(changes)}, '$.added', json(${loginsApart(given, stored)}), '$.removed', json(${loginsApart(stored, given)}))`;
  const detail = changes.logins === undefined ? fragment`${JSON.stringify(changes)}` : users;

  return insertFrom(audit, PLAIN_AUDIT_COLUMNS, fragment`SELECT ${signed.at}, ${signed.by}, 'settings_changed', ${detail} FROM ${settings} WHERE ${lands}`);
}

/** More requests on a day for a site, some of them page views, with the rows the database used, and the count of requests after them. */
function addRequests(counted: { readonly day: string; readonly site: string; readonly requests: number; readonly views: number; readonly rows: RowsUsed }): Statement {
  const { day, site, requests, views, rows } = counted;
  const added = {
    requests: fragment`${bare(requestCounts.requests)} + excluded.${bare(requestCounts.requests)}`,
    views: fragment`${bare(requestCounts.views)} + excluded.${bare(requestCounts.views)}`,
    rows_read: fragment`${bare(requestCounts.rows_read)} + excluded.${bare(requestCounts.rows_read)}`,
    rows_written: fragment`${bare(requestCounts.rows_written)} + excluded.${bare(requestCounts.rows_written)}`,
  };
  const row = { day, site, requests, views, rows_read: rows.read, rows_written: rows.written };
  const counts = BUILD.insert(requestCounts).values(row).onConflictDoUpdate({ target: [requestCounts.day, requestCounts.site], set: added });

  return built(counts.returning({ requests: requestCounts.requests }));
}

/** The count of a day for a site; no row when nothing was counted. */
function requestsOf(day: string, site: string): Statement {
  return built(BUILD.select({ requests: requestCounts.requests }).from(requestCounts).where(and(eq(requestCounts.day, day), eq(requestCounts.site, site))));
}

/** The two statements that move the live site with an id to the trash while a further condition holds for it: the move, and its audit entry. */
function trashing(holds: SQL | undefined, id: SiteId, signed: Signed): [move: Statement, entry: Statement] {
  return [built(BUILD.update(sites).set({ trashed_at: signed.at }).where(and(eq(sites.id, id), eq(sites.trashed, 0), holds))), auditOfSite(signed, "trash", id, {})];
}

/** The three statements that remove the site with an id for good while a condition holds for it: the read of it as it is, its audit entry, written while the site is still there to name, and the delete, only when the entry was. */
function deletion(holds: SQL | undefined, id: SiteId, signed: Signed): [before: Statement, entry: Statement, remove: Statement] {
  const entry = fragment`SELECT ${signed.at}, ${signed.by}, 'delete', ${sites.id}, ${sites.name}, '{}' FROM ${sites} WHERE ${holds}`;

  return [siteById(id), insertFrom(audit, AUDIT_COLUMNS, entry), built(BUILD.delete(sites).where(and(eq(sites.id, id), CHANGED)))];
}

/** One call names at most a page of sites or folders: each is a bound value of its statement, or a statement of its batch. */
function requireFew(named: readonly unknown[]): void {
  if (named.length > MAX_PAGE) throw new RangeError(`one call names at most ${MAX_PAGE} sites or folders, not ${named.length}`);
}

function requirePage(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new RangeError(`a page holds 1 to ${MAX_PAGE} rows, not ${limit}`);
}

function requireAuditPage(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_AUDIT_PAGE) throw new RangeError(`a reading of the log holds 1 to ${MAX_AUDIT_PAGE} entries, not ${limit}`);
}

function requireCount(what: string, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`${what} is a whole number from 0 up, not ${count}`);
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

/**
 * The update of a live site's details that changes a row only where a detail differs, with the details as they were checked; `undefined` when no detail is asked.
 *
 * @param also - a further condition the site must meet
 * @throws {Error} a detail breaks its field rule
 */
function detailsUpdate(id: SiteId, details: SiteDetails, also?: SQL): { readonly update: Statement; readonly given: Readonly<Record<string, unknown>> } | undefined {
  const given = v.parse(SITE_DETAILS, details);
  const stored = storedDetails(given);
  const columns = Object.keys(stored) as (keyof typeof stored)[];
  if (columns.length === 0) return undefined;

  const differs = or(...columns.map((column) => fragment`${sites[column]} IS NOT ${stored[column] ?? null}`));

  return { update: built(BUILD.update(sites).set(stored).where(and(eq(sites.id, id), eq(sites.trashed, 0), also, differs))), given };
}

/** What an access asked for a site comes to when it changed no row, from the read of the site after: there is none, it sits in the trash, it has that access already, or its public name is taken. */
function accessLeft(after: StatementResult | undefined, access: SiteAccess): Unchanged | Refused<"not_found" | "in_trash" | "name_taken"> {
  const site = siteIn(after);
  const refusal = unreachable(site);
  if (site === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

  if (site.access === access.access && publicNameOf(site) === publicNameOf(access)) return { kind: "unchanged", site };

  return { kind: "name_taken" };
}

function uploadIn(result: StatementResult | undefined): Upload | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : uploadFromRow(row);
}

function loginIn(result: StatementResult | undefined): ComputerLogin | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : computerLoginFromRow(row);
}

function visitorKeyIn(result: StatementResult | undefined): Uint8Array<ArrayBuffer> | undefined {
  const row = result?.rows[0];

  return row === undefined ? undefined : visitorKeyFromRow(row);
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
  const auto: unknown = typeof row.auto === "string" ? JSON.parse(row.auto) : null;
  const check = v.safeParse(UPDATE_CHECK, { checked_at: row.checked_at, news, seen_at: row.seen_at, auto });

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

/** Core's database over any SQLite a driver reaches: the host's own in an install, `bun:sqlite` in the tests. */
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

  async getSite(id: SiteId): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([siteById(id)]);

    return siteIn(found);
  }

  async getSiteWithSettings(id: SiteId): Promise<SettingsAndSite> {
    const [stored, found] = await this.#driver.batch([READ_SETTINGS, siteById(id)]);

    return { settings: settingsIn(stored), site: siteIn(found) };
  }

  async getShownSite(id: SiteId, shown: SitesShown): Promise<ShownSite> {
    requireDay(shown.day);
    const one = BUILD.select({ ...SITE_FIELDS, listed_by: fragment`${sites.id}`.as("listed_by") }).from(sites).where(eq(sites.id, id));
    const [stored, found] = await this.#driver.batch([READ_SETTINGS, pageWithBeside(fragment`${one}`, shown, false)]);
    const row = found?.rows[0];
    const beside = row === undefined ? undefined : v.parse(SHOWN_BESIDE, row);
    const publishers = new Map(Object.entries(beside?.publishers ?? {}) as [TokenId, string][]);

    return { settings: settingsIn(stored), site: siteIn(found), views: beside?.views ?? { today: 0, week: 0 }, publishers };
  }

  async getSiteNames(ids: readonly SiteId[]): Promise<ReadonlyMap<SiteId, SiteNamed>> {
    const asked = [...new Set(ids)];
    if (asked.length > MOST_SITES_ASKED) throw new RangeError(`the names of at most ${MOST_SITES_ASKED} sites are read at once, not of ${asked.length}`);

    if (asked.length === 0) return new Map();

    // Each id is a value bound to the statement, which the engine finds by its key. A database binds only so many, hence the bound above.
    const names = BUILD.select(NAMED_FIELDS).from(sites).where(inArray(sites.id, asked));
    const [found] = await this.#driver.batch([built(names)]);
    const named = (found?.rows ?? []).map((row) => v.parse(NAMED_SITE, row));

    return new Map(named.map(({ id, ...called }) => [id, called]));
  }

  async getLaterSites(ids: readonly SiteId[]): Promise<ReadonlyMap<SiteId, SiteNow>> {
    const asked = [...new Set(ids)];
    if (asked.length > MOST_SITES_ASKED) throw new RangeError(`at most ${MOST_SITES_ASKED} earlier ids are looked up at once, not ${asked.length}`);

    if (asked.length === 0) return new Map();

    // Each id is found by its key, and its site by the folder it keeps: one step, however many new links the site has had since.
    const later = BUILD.select(LATER_FIELDS).from(earlierIds).innerJoin(sites, eq(sites.folder, earlierIds.folder)).where(inArray(earlierIds.id, asked));
    const [found] = await this.#driver.batch([built(later)]);
    const sitesNow = (found?.rows ?? []).map((row) => v.parse(LATER_SITE, row));

    return new Map(sitesNow.map(({ earlier, ...site }) => [earlier, site]));
  }

  async getSiteByPublicName(name: PublicName): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([sitesWhere(eq(sites.public_name, name))]);

    return siteIn(found);
  }

  async findTaken(id: SiteId, publicName?: PublicName): Promise<Taken> {
    // A name left out is no site's.
    const nameHeld = publicName === undefined ? fragment`0` : fragment`NOT (${isFree(publicName)})`;
    const [found] = await this.#driver.batch([written(fragment`SELECT NOT (${isFree(id)}) AS id_held, ${nameHeld} AS name_held`)]);

    return { id: found?.rows[0]?.id_held === 1, publicName: found?.rows[0]?.name_held === 1 };
  }

  async getSiteByFolder(folder: Site["folder"]): Promise<Site | undefined> {
    const [found] = await this.#driver.batch([sitesWhere(eq(sites.folder, folder))]);

    return siteIn(found);
  }

  async findServed(address: Address, now: number): Promise<ServedSite | undefined> {
    return (await this.findServedWith(address, now, {})).served;
  }

  async findServedWith(address: Address, now: number, also: ServedAlso): Promise<ServedLookup> {
    if (also.counts !== undefined) requireDay(also.counts.day);

    const addressed = "id" in address ? eq(sites.id, address.id) : eq(sites.public_name, address.public_name);
    const counts = also.counts === undefined ? [] : [requestsOf(also.counts.day, ALL_SITES), requestsOf(also.counts.day, also.counts.site)];
    const held = also.settingsAndKey === true ? [READ_SETTINGS, READ_VISITOR_KEY] : [];
    const [found, ...beside] = await this.#driver.batch([servedSite(addressed, now), ...counts, ...held]);
    const [all, ofSite] = counts.length === 0 ? [] : beside;
    const [stored, key] = held.length === 0 ? [] : beside.slice(counts.length);

    return {
      served: servedIn(found),
      ...(counts.length === 0 ? {} : { counts: { site: requestsIn(ofSite), all: requestsIn(all) } }),
      ...(held.length === 0 ? {} : { settingsAndKey: { settings: settingsIn(stored), key: visitorKeyIn(key) } }),
    };
  }

  async listSites(query: SitesQuery): Promise<SitesPage> {
    requirePage(query.limit);
    const [listed] = await this.#driver.batch([built(pageAsked(query).page)]);

    return pageIn(listed, query);
  }

  async listShownSites(query: SitesQuery, shown: SitesShown): Promise<ShownSitesPage> {
    requirePage(query.limit);
    requireDay(shown.day);
    const { page, descending } = pageAsked(query);
    const [stored, listed] = await this.#driver.batch([READ_SETTINGS, pageWithBeside(fragment`${page}`, shown, descending)]);
    const beside = (listed?.rows ?? []).slice(0, query.limit).map((row) => v.parse(SHOWN_BESIDE, row));
    const { sites: listedSites, next } = pageIn(listed, query);
    const views = new Map(listedSites.map((site, at) => [site.id, beside[at]?.views ?? { today: 0, week: 0 }]));
    const publishers = new Map(beside.flatMap((row) => Object.entries(row.publishers) as [TokenId, string][]));

    return { sites: listedSites, ...(next === undefined ? {} : { next }), settings: settingsIn(stored), views, publishers };
  }

  async changeAccess(id: SiteId, access: SiteAccess, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">> {
    const publicName = publicNameOf(access);
    const [updated, , after] = await this.#driver.batch([
      setAccess(id, access.access, publicName),
      auditOfSite(signed, "access", id, { access: access.access, public_name: publicName }),
      siteById(id),
    ]);

    return changed(updated) ? done(after) : accessLeft(after, access);
  }

  async changeAccessAndDetails(id: SiteId, access: SiteAccess, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">> {
    const publicName = publicNameOf(access);
    // The details change only once the site has the access asked, which the statement before them gave it or it had.
    const asked = detailsUpdate(id, details, and(eq(sites.access, access.access), fragment`${sites.public_name} IS ${publicName}`));
    if (asked === undefined) return this.changeAccess(id, access, signed);

    const [opened, , detailed, , after] = await this.#driver.batch([
      setAccess(id, access.access, publicName),
      auditOfSite(signed, "access", id, { access: access.access, public_name: publicName }),
      asked.update,
      auditOfSite(signed, "details", id, asked.given),
      siteById(id),
    ]);

    return changed(opened) || changed(detailed) ? done(after) : accessLeft(after, access);
  }

  async changeDetails(id: SiteId, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash">> {
    const asked = detailsUpdate(id, details);
    if (asked === undefined) return this.#unchanged(id);

    const [updated, , after] = await this.#driver.batch([asked.update, auditOfSite(signed, "details", id, asked.given), siteById(id)]);
    if (changed(updated)) return done(after);

    return this.#unchangedIn(after);
  }

  async giveNewId(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const next = this.#mintId();
      const kept = daysUpTo(dayOf(signed.at), KEPT_DAYS);
      const days = JSON.stringify(kept);
      // The days are walked only once the id was given: the list of them stands behind a row that is there only then.
      const counted = fragment`(SELECT j.value FROM (SELECT 1 WHERE ${CHANGED}) AS given CROSS JOIN json_each(${days}) AS j)`;
      const [updated, , , after, before] = await this.#driver.batch([
        built(BUILD.update(sites).set({ id: next }).where(and(eq(sites.id, id), eq(sites.trashed, 0), isFree(next)))),
        auditOfSite(signed, "new_id", next, { from: id }),
        keepEarlierId(id, next),
        siteById(next),
        siteById(id),
        built(BUILD.update(requestCounts).set({ site: next }).where(and(eq(requestCounts.site, id), fragment`${requestCounts.day} IN ${counted}`))),
        sumsMoved(id, next, kept[0] ?? dayOf(signed.at)),
      ]);
      if (changed(updated)) return done(after);

      const refusal = unreachable(siteIn(before));
      if (refusal !== undefined) return refusal;
    }

    throw new Error(`no free site id in ${MINT_ATTEMPTS} tries`);
  }

  async trashSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    const { moved, after } = await this.#trashWhere(undefined, id, signed);
    if (moved) return done(after);

    return unreachable(siteIn(after)) ?? { kind: "not_found" };
  }

  async listDueSites(due: DueSites, limit: number): Promise<readonly SiteId[]> {
    requirePage(limit);
    // Each condition is the one its index holds, so the engine walks the due sites alone and reads no site's row.
    const [dueBy, since] = "expiredBy" in due ? [sites.expires_at, and(lte(sites.expires_at, due.expiredBy), isNull(sites.trashed_at))] : [sites.trashed_at, lte(sites.trashed_at, due.trashedBy)];
    const [found] = await this.#driver.batch([built(BUILD.select({ id: sites.id }).from(sites).where(since).orderBy(asc(dueBy), asc(sites.id)).limit(limit))]);

    return (found?.rows ?? []).map((row) => v.parse(SITE_ID, row.id));
  }

  async trashExpiredSites(ids: readonly SiteId[], signed: Signed): Promise<number> {
    requireFew(ids);
    if (ids.length === 0) return 0;

    const moved = await this.#driver.batch(ids.flatMap((id) => trashing(lte(sites.expires_at, signed.at), id, signed)));

    return ids.filter((_id, at) => changed(moved[at * 2])).length;
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
    return (await this.#deleteWhere(eq(sites.id, id), id, signed)) ?? { kind: "not_found" };
  }

  async deleteSatOutSites(ids: readonly SiteId[], signed: Signed, trashedBy: number): Promise<readonly Site[]> {
    requireFew(ids);
    if (ids.length === 0) return [];

    const removed = await this.#driver.batch(ids.flatMap((id) => deletion(and(eq(sites.id, id), lte(sites.trashed_at, trashedBy)), id, signed)));

    return ids.flatMap((_id, at) => (changed(removed[at * 3 + 2]) ? [done(removed[at * 3]).site] : []));
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

  async forgetLeftovers(folders: readonly SiteFolder[]): Promise<void> {
    requireFew(folders);
    if (folders.length === 0) return;

    // A statement a folder: a list of them in one statement is read a row a folder more.
    await this.#driver.batch(folders.map((folder) => built(BUILD.delete(leftovers).where(eq(leftovers.folder, folder)))));
  }

  async reserveVersion(id: SiteId): Promise<Reserved | Refused<"not_found" | "in_trash">> {
    const reserve = BUILD.update(sites).set({ next_version: fragment`${sites.next_version} + 1` }).where(and(eq(sites.id, id), eq(sites.trashed, 0)));
    const number = BUILD.select({ number: fragment<number>`${sites.next_version} - 1`.as("number") }).from(sites).where(eq(sites.id, id));
    const [updated, reserved, after] = await this.#driver.batch([built(reserve), built(number), siteById(id)]);
    if (changed(updated)) return { kind: "reserved", number: Number(reserved?.rows[0]?.number) };

    return unreachable(siteIn(after)) ?? { kind: "not_found" };
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

  async importUploadAsSite(id: UploadId, site: Site, signed: Signed, contents: ReadonlyMap<number, VersionContents> = new Map()): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken" | "not_pending">> {
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
    // The live version is there already, made with the site, and takes its exported values and what it is said to hold.
    const exported = VERSION_COLUMNS.slice(1);
    const listed = fragment.join(exported.map((column) => fragment`j.value ->> ${fragment.raw(`'${column.name}'`)}`), fragment`, `);
    const taken = fragment.join(exported.slice(1).map((column) => fragment`${bare(column)} = excluded.${bare(column)}`), fragment`, `);
    const kept = fragment`SELECT ${row.folder}, ${listed} FROM json_each(${versionsWithContents(row.versions, contents)}) j WHERE ${CHANGED} ON CONFLICT (${bare(versions.folder)}, ${bare(versions.number)}) DO UPDATE SET ${taken}`;
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

  async addUpload(upload: NewUpload, room: UploadRoom): Promise<{ readonly kind: "done" } | Refused<"own_full" | "folder_full" | "total_full" | "sites_full"> | (Refused<"day_full" | "writes_full"> & { readonly left: number })> {
    requireDay(room.day);
    const manifest = manifestToText(upload.manifest);
    const bytes = upload.manifest.reduce((sum, file) => sum + file.size, 0);
    const row = { ...upload, state: "pending", plan: JSON.stringify(upload.plan), bytes, files: upload.manifest.length, dropped: "[]" };
    const checked = uploadFromRow(row);
    const own = pendingOf(checked.owner);
    const folderBytes = bytesIn(checked.folder, room.staying);
    const dayFiles = fragment`(SELECT COALESCE(SUM(${declaredFiles.files}), 0) FROM ${declaredFiles} WHERE ${declaredFiles.day} = ${room.day})`;
    // The day's one row is read once for both of its bounds: the files declared on it, and the writes to the store counted on it.
    const overDay = fragment`${declaredFiles.files} + ${checked.files} > ${room.dayFiles} OR ${declaredFiles.writes} + ${room.writes} > ${room.dayWrites}`;
    const dayFits = fragment`NOT EXISTS (SELECT 1 FROM ${declaredFiles} WHERE ${declaredFiles.day} = ${room.day} AND (${overDay})) AND ${checked.files} <= ${room.dayFiles} AND ${room.writes} <= ${room.dayWrites}`;
    // What the upload is measured against is read before it is recorded, so a refusal can say which room is full.
    const held = fragment`SELECT ${checked.id} AS id, ${checked.number} AS number, ${own} AS own, ${folderBytes} AS folder_bytes, ${BYTES_HELD} AS total_bytes, ${SITES_HELD} AS sites`;
    const bytesFit = fragment`${folderBytes} + ${checked.bytes} <= ${room.folderBytes} AND ${BYTES_HELD} + ${checked.bytes} <= ${room.totalBytes}`;
    const fits = fragment`${own} < ${room.own} AND ${bytesFit} AND (${room.sites} IS NULL OR ${SITES_HELD} < ${room.sites}) AND ${dayFits}`;
    const columns = [uploads.id, uploads.folder, uploads.number, uploads.owner, uploads.plan, uploads.manifest, uploads.bytes, uploads.files, uploads.created_at];
    const record = fragment`SELECT ${checked.id}, ${checked.folder}, ${checked.number}, ${checked.owner}, ${row.plan}, ${manifest}, ${checked.bytes}, ${checked.files}, ${checked.created_at} WHERE ${fits}`;
    const [files, writes] = [bare(declaredFiles.files), bare(declaredFiles.writes)];
    const added = fragment`${files} = ${files} + excluded.${files}, ${writes} = ${writes} + excluded.${writes}`;
    const counted = fragment`SELECT ${room.day}, ${checked.files}, ${room.writes} WHERE ${CHANGED} ON CONFLICT (${bare(declaredFiles.day)}) DO UPDATE SET ${added}`;

    const [before, inserted] = await this.#driver.batch([
      written(held),
      insertFrom(uploads, columns, record),
      insertFrom(declaredFiles, [declaredFiles.day, declaredFiles.files, declaredFiles.writes], counted),
    ]);
    if (changed(inserted)) return { kind: "done" };

    const measured = before?.rows[0];
    if (Number(measured?.own) >= room.own) return { kind: "own_full" };

    if (Number(measured?.folder_bytes) + checked.bytes > room.folderBytes) return { kind: "folder_full" };

    if (Number(measured?.total_bytes) + checked.bytes > room.totalBytes) return { kind: "total_full" };

    if (room.sites !== null && Number(measured?.sites) >= room.sites) return { kind: "sites_full" };

    // Only a refused upload pays for the read that says which bound of the day it did not fit, and how much of that bound is left.
    const [day] = await this.#driver.batch([written(fragment`SELECT ${dayFiles} AS files, ${writesOf(room.day)} AS writes`)]);
    const declared = Number(day?.rows[0]?.files);
    if (declared + checked.files > room.dayFiles) return { kind: "day_full", left: Math.max(0, room.dayFiles - declared) };

    return { kind: "writes_full", left: Math.max(0, room.dayWrites - Number(day?.rows[0]?.writes)) };
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

  async getUploadFiles(id: UploadId, paths: readonly string[]): Promise<{ readonly upload: Upload; readonly files: readonly (ManifestFile | undefined)[] } | undefined> {
    // The engine reads one value out of the row for each key, and walks no other entry of the manifest. A key is written into the statement, which binds a hundred values at most, and is checked to be the letter and hex digits a key is made of.
    const keys = [...new Set(paths.map(manifestKey))];
    if (!keys.every((key) => MANIFEST_KEY.test(key))) throw new Error("a manifest key is not a letter and hex digits");

    const lists: Record<string, SQL.Aliased<string>> = {};
    for (let at = 0; at < keys.length; at += KEYS_PER_LIST) {
      const read = keys.slice(at, at + KEYS_PER_LIST).map((key) => fragment`json_extract(${uploads.manifest}, ${fragment.raw(`'$.${key}'`)})`);
      lists[`named_${at}`] = fragment<string>`json_array(${fragment.join(read, fragment`, `)})`.as(`named_${at}`);
    }

    const [found] = await this.#driver.batch([built(BUILD.select({ ...UPLOAD_FIELDS, ...lists }).from(uploads).where(eq(uploads.id, id)))]);
    const upload = uploadIn(found);
    if (upload === undefined) return undefined;

    const row = found?.rows[0];

    return { upload, files: filesUnderKeys(Object.keys(lists).map((name) => String(row?.[name])), paths) };
  }

  async publishUploadAsSite(id: UploadId, draft: NewSite, signed: Signed, made: MadeWith = {}): Promise<Done | Refused<"name_taken" | "not_pending">> {
    const site = v.parse(NEW_SITE, draft);
    const [missingPage, bareFiles] = contentsValues(made.contents);
    const first = { bytes: site.bytes, files: site.files, missing_page: missingPage, bare_files: bareFiles };
    const publicName = publicNameOf(site);
    const detail = { access: site.access, public_name: publicName };
    // The first version, which the schema made with the site, is given its size and what it holds only when the site was made.
    const size = BUILD.update(versions).set(first).where(and(eq(versions.folder, site.folder), eq(versions.number, 1), CHANGED));
    const held = fragment`SELECT (EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.public_name} = ${publicName}) OR EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.id} = ${publicName})) AS held`;

    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const minted = this.#mintId();
      // A copy's second entry follows the first, so it is written only when the site was made, and the upload is finished only after both.
      const copied = made.copiedFrom === undefined ? [] : [auditOfSite(signed, "duplicate", minted, { from: made.copiedFrom })];
      const answers = await this.#driver.batch([
        insertSite(minted, site, signed, id),
        built(size),
        auditOfSite(signed, "create", minted, detail),
        ...copied,
        finishUpload(id),
        written(held),
        siteById(minted),
        uploadById(id),
      ]);
      const [inserted] = answers;
      const [taken, stored, waiting] = answers.slice(-3);
      if (changed(inserted)) return done(stored);

      if (uploadIn(waiting)?.state !== "pending") return { kind: "not_pending" };

      if (publicName !== null && taken?.rows[0]?.held === 1) return { kind: "name_taken" };
    }

    throw new Error(`no free site id in ${MINT_ATTEMPTS} tries`);
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
    const [missingPage, bareFiles] = contentsValues(version.contents);
    const size = fragment`${AN_UPLOAD.bytes}, ${AN_UPLOAD.files}, ${missingPage}, ${bareFiles}`;
    const uploaded = fragment`SELECT ${AN_UPLOAD.folder}, ${AN_UPLOAD.number}, ${signed.at}, ${signed.by}, ${size} FROM ${uploads} ${AN_UPLOAD} WHERE ${publishable}`;
    const number = fragment<number>`(SELECT ${uploads.number} FROM ${uploads} WHERE ${uploads.id} = ${id})`;
    const entry = fragment`SELECT ${signed.at}, ${signed.by}, 'publish', ${sites.id}, ${sites.name}, json_object('version', ${sites.live_version}) FROM ${sites} WHERE ${inFolder} AND ${CHANGED}`;
    // The upload is finished with the versions beyond the highest kept, which the statement after it drops.
    const highest = fragment`(SELECT ${A_KEPT_VERSION.number} FROM ${versions} ${A_KEPT_VERSION} WHERE ${A_KEPT_VERSION.folder} = ${uploads.folder} ORDER BY ${A_KEPT_VERSION.number} DESC LIMIT ${version.keep})`;
    const dropped = fragment<string>`(SELECT json_group_array(${A_VERSION.number}) FROM ${versions} ${A_VERSION} WHERE ${A_VERSION.folder} = ${uploads.folder} AND ${A_VERSION.number} NOT IN ${highest})`;
    const isHeld = fragment`SELECT (EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.public_name} = ${publicName} AND ${sites.folder} <> ${folderOf(id)}) OR EXISTS (SELECT 1 FROM ${sites} WHERE ${sites.id} = ${publicName})) AS held`;
    // The site is read first, as it was before any setting asked with the version.
    const results = await this.#driver.batch([
      sitesWhere(inFolder),
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
    const before = siteIn(results[0]);
    const [inserted, , , , , after, finished, held] = results.slice(settings.length + 1);
    const upload = uploadIn(finished);
    if (changed(inserted) && upload !== undefined && before !== undefined) return { ...done(after), before, dropped: upload.dropped };

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

  async addToken(token: TokenRecord, signed: Signed): Promise<{ readonly kind: "done" } | Refused<"id_taken" | "signer_gone">> {
    const expires = token.scope === "admin" ? token.expiresAt : null;
    const idIsFree = fragment`NOT EXISTS (SELECT 1 FROM ${tokens} WHERE ${tokens.id} = ${token.id})`;
    const made = fragment`SELECT ${token.id}, ${token.hash}, ${token.scope}, ${token.note}, ${token.createdAt}, ${expires}, ${userBehind(signed.by)} WHERE ${idIsFree} AND ${signerStands(signed)}`;
    const [inserted, , signer] = await this.#driver.batch([
      insertFrom(tokens, TOKEN_COLUMNS, made),
      auditPlain(signed, "token_added", { token: token.id, scope: token.scope, note: token.note }),
      written(fragment`SELECT ${signerStands(signed)} AS stands`),
    ]);
    if (changed(inserted)) return { kind: "done" };

    return { kind: signer?.rows[0]?.stands === 1 ? "id_taken" : "signer_gone" };
  }

  async getToken(id: TokenId): Promise<TokenRecord | undefined> {
    const [found] = await this.#driver.batch([tokenById(id)]);
    const row = found?.rows[0];

    return row === undefined ? undefined : tokenFromRow(row);
  }

  async listTokens(): Promise<readonly TokenRecord[]> {
    const [listed] = await this.#driver.batch([built(BUILD.select(TOKEN_FIELDS).from(tokens).where(NOT_REMOVED).orderBy(desc(tokens.created_at), desc(tokens.id)))]);

    return (listed?.rows ?? []).map(tokenFromRow);
  }

  async getTokenNames(ids: readonly TokenId[]): Promise<ReadonlyMap<TokenId, string>> {
    const asked = [...new Set(ids)];
    if (asked.length === 0) return new Map();

    const statements: Statement[] = [];
    for (let from = 0; from < asked.length; from += TOKENS_A_STATEMENT) statements.push(tokenNames(asked.slice(from, from + TOKENS_A_STATEMENT)));

    const found = await this.#driver.batch(statements);
    const named = found.flatMap((some) => some.rows).map((row) => v.parse(NAMED_TOKEN, row));

    return new Map(named.map(({ id, note }) => [id, note]));
  }

  async listTokenStates(now: number, mostEnded: number): Promise<TokenStates> {
    requirePage(mostEnded);

    const live = BUILD.select(TOKEN_FIELDS).from(tokens).where(worksAt(now)).orderBy(desc(tokens.created_at), desc(tokens.id));
    // A removal is never ahead of the clock, so `end_at` up to now holds every removed token and every one that ran out. One that ended before the days kept waits for the sweep, and is told no more.
    const ended = BUILD.select(ENDED_TOKEN_FIELDS).from(tokens).where(and(lte(tokens.end_at, now), gte(tokens.end_at, now - HISTORY_KEPT_MS))).orderBy(desc(tokens.end_at), desc(tokens.id));
    const [lived, over] = await this.#driver.batch([built(live), built(ended.limit(mostEnded + 1))]);
    const rows = over?.rows ?? [];

    return { live: (lived?.rows ?? []).map(tokenFromRow), ended: rows.slice(0, mostEnded).map(endedTokenFromRow), more: rows.length > mostEnded };
  }

  async countUserTokens(now: number): Promise<ReadonlyMap<string, number>> {
    const [counted] = await this.#driver.batch([userTokenCounts(now)]);

    return new Map((counted?.rows ?? []).map((row) => v.parse(USER_TOKENS, row)).map((row) => [row.allowed_by, row.held]));
  }

  async revokeToken(id: TokenId, signed: Signed): Promise<{ readonly kind: "done"; readonly token: TokenRecord } | Refused<"not_found">> {
    // The audit entry is written only for a token that was not removed before, and the mark only when the entry was.
    const named = fragment`json_object('token', ${tokens.id}, 'scope', ${tokens.scope}, 'note', ${tokens.note})`;
    const entry = fragment`SELECT ${signed.at}, ${signed.by}, 'token_revoked', ${named} FROM ${tokens} WHERE ${tokens.id} = ${id} AND ${NOT_REMOVED}`;
    const mark = BUILD.update(tokens).set({ removed_at: signed.at, removed_by: signed.by }).where(and(eq(tokens.id, id), CHANGED));
    const [before, , marked] = await this.#driver.batch([tokenById(id), insertFrom(audit, PLAIN_AUDIT_COLUMNS, entry), built(mark)]);
    const row = before?.rows[0];
    if (!changed(marked) || row === undefined) return { kind: "not_found" };

    return { kind: "done", token: tokenFromRow(row) };
  }

  async addComputerLogin(login: PendingLogin, room: LoginRoom): Promise<{ readonly kind: "done" } | Refused<"taken">> {
    const columns = [logins.id, logins.code, logins.hash, logins.scope, logins.computer, logins.visitor, logins.created_at, logins.expires_at];
    const values = fragment`${login.id}, ${login.code}, ${login.hash}, ${login.scope}, ${login.computer}, ${login.visitor}, ${login.createdAt}, ${login.expiresAt}`;
    const [, , inserted] = await this.#driver.batch([
      makeRoomOfVisitor(login, room.perVisitor - 1),
      makeRoomOfAll(login, room.all),
      insertFrom(logins, columns, fragment`SELECT ${values} WHERE ${isNewLogin(login)}`),
    ]);

    return { kind: changed(inserted) ? "done" : "taken" };
  }

  async getComputerLogin(id: LoginId): Promise<ComputerLogin | undefined> {
    const [found] = await this.#driver.batch([loginsWhere(eq(logins.id, id))]);

    return loginIn(found);
  }

  async findComputerLogin(code: UserCode): Promise<ComputerLogin | undefined> {
    const [found] = await this.#driver.batch([loginsWhere(eq(logins.code, code))]);

    return loginIn(found);
  }

  async listWaitingComputerLogins(now: number): Promise<readonly PendingLogin[]> {
    const waiting = BUILD.select().from(logins).where(and(eq(logins.state, "pending"), gt(logins.expires_at, now))).orderBy(desc(logins.created_at), desc(logins.id));
    const [listed] = await this.#driver.batch([built(waiting)]);

    return (listed?.rows ?? []).map(computerLoginFromRow).filter((login) => login.state === "pending");
  }

  async decideComputerLogin(code: UserCode, decision: LoginDecision): Promise<{ readonly kind: "done"; readonly login: ComputerLogin } | Refused<"not_pending">> {
    // An allowed login becomes a publisher's when its decider asks so.
    const scope = fragment<"admin" | "publisher">`CASE WHEN ${decision.asPublisher === true ? 1 : 0} = 1 AND ${decision.state} = 'allowed' THEN 'publisher' ELSE ${logins.scope} END`;
    const waits = and(eq(logins.code, code), eq(logins.state, "pending"), gt(logins.expires_at, decision.at));
    const action = decision.state === "allowed" ? "login_allowed" : "login_denied";
    // The entry names the scope and the computer, and nothing of the secret.
    const entry = fragment`SELECT ${decision.at}, ${decision.by}, ${action}, json_object('scope', ${logins.scope}, 'computer', ${logins.computer}) FROM ${logins} WHERE ${logins.code} = ${code} AND ${CHANGED}`;
    const [updated, , after] = await this.#driver.batch([
      built(BUILD.update(logins).set({ state: decision.state, decided_by: decision.by, scope }).where(waits)),
      insertFrom(audit, PLAIN_AUDIT_COLUMNS, entry),
      loginsWhere(eq(logins.code, code)),
    ]);
    const login = loginIn(after);
    if (!changed(updated) || login === undefined) return { kind: "not_pending" };

    return { kind: "done", login };
  }

  async redeemComputerLogin(id: LoginId, token: TokenRecord): Promise<{ readonly kind: "done" } | Refused<"not_allowed">> {
    const expires = token.scope === "admin" ? token.expiresAt : null;
    const detail = JSON.stringify({ token: token.id, scope: token.scope, note: token.note });
    // A token is stored only while the login is allowed, has not run out, is of the token's scope, and whoever allowed it is a user still.
    const decided = fragment`${logins.state} = 'allowed' AND ${isUser(fragment`${logins.decided_by}`)}`;
    const allowed = fragment`${logins.id} = ${id} AND ${decided} AND ${logins.expires_at} > ${token.createdAt} AND ${logins.scope} = ${token.scope}`;
    const idIsFree = fragment`NOT EXISTS (SELECT 1 FROM ${tokens} WHERE ${tokens.id} = ${token.id})`;
    const stored = fragment`SELECT ${token.id}, ${token.hash}, ${logins.scope}, ${token.note}, ${token.createdAt}, ${expires}, ${logins.decided_by} FROM ${logins} WHERE ${allowed} AND ${idIsFree}`;
    // The entry is signed by whoever allowed the login, and the login goes only when the entry was written.
    const entry = fragment`SELECT ${token.createdAt}, ${logins.decided_by}, 'token_added', ${detail} FROM ${logins} WHERE ${logins.id} = ${id} AND ${CHANGED}`;
    const [inserted] = await this.#driver.batch([
      insertFrom(tokens, TOKEN_COLUMNS, stored),
      insertFrom(audit, PLAIN_AUDIT_COLUMNS, entry),
      built(BUILD.delete(logins).where(and(eq(logins.id, id), CHANGED))),
    ]);

    return { kind: changed(inserted) ? "done" : "not_allowed" };
  }

  async sweepRunOut(now: number): Promise<number> {
    const day = dayOf(now);
    const firstKept = daysUpTo(day, KEPT_DAYS)[0] ?? day;
    const [removed] = await this.#driver.batch([
      built(BUILD.delete(logins).where(lte(logins.expires_at, now))),
      problemsForgotten(now),
      dropEarlierDays(day),
      // The days before the oldest one kept are dropped, so the tables hold a year.
      sumsDroppedBefore(firstKept),
      built(BUILD.delete(requestCounts).where(lt(requestCounts.day, firstKept))),
      viewsSummed(now),
      auditTrimmed(now),
      endedTokensTrimmed(now),
    ]);

    return removed?.changes ?? 0;
  }

  async noteProblem(note: ProblemNote): Promise<boolean> {
    const [noted] = await this.#driver.batch([problemNoted(note)]);

    return changed(noted);
  }

  async endProblems(mends: readonly Mend[], now: number): Promise<void> {
    const ended = problemsEnded(mends, now);
    if (ended !== undefined) await this.#driver.batch([ended]);
  }

  async listProblems(since: string): Promise<readonly Problem[]> {
    const [read] = await this.#driver.batch([problemsAsked(since)]);

    return problemsIn(read);
  }

  async readSweepPlace(): Promise<SweepPlace | undefined> {
    const [read] = await this.#driver.batch([READ_SWEEP_PLACE]);

    return placeIn(read);
  }

  async readSweepStart(): Promise<SweepStart> {
    const [update, stored, place] = await this.#driver.batch([READ_UPDATE_CHECK, READ_SETTINGS, READ_SWEEP_PLACE]);

    return { updateCheck: updateCheckIn(update), settings: settingsIn(stored), place: placeIn(place) };
  }

  async keepSweepPlace(place: SweepPlace | undefined): Promise<void> {
    if (place === undefined) {
      await this.#driver.batch([built(BUILD.delete(sweepPlace))]);

      return;
    }

    const stopped = { id: 1, place: JSON.stringify(v.parse(SWEEP_PLACE, place)) };
    const kept = { place: fragment`excluded.${bare(sweepPlace.place)}` };
    await this.#driver.batch([built(BUILD.insert(sweepPlace).values(stopped).onConflictDoUpdate({ target: sweepPlace.id, set: kept }))]);
  }

  async readUpdateCheck(): Promise<UpdateCheck | undefined> {
    const [read] = await this.#driver.batch([READ_UPDATE_CHECK]);

    return updateCheckIn(read);
  }

  async keepUpdateCheck(check: Pick<UpdateCheck, "checked_at" | "news">): Promise<UpdateCheck> {
    const { checked_at, news } = v.parse(v.pick(UPDATE_CHECK, ["checked_at", "news"]), check);

    const asked = { id: 1, checked_at, news: news === null ? null : JSON.stringify(news), seen_at: news === null ? null : checked_at };
    const sameVersion = fragment`json_extract(${qualified(updateCheck.news)}, '$.version') IS json_extract(excluded.${bare(updateCheck.news)}, '$.version')`;
    const kept = {
      checked_at: fragment`excluded.${bare(updateCheck.checked_at)}`,
      news: fragment`excluded.${bare(updateCheck.news)}`,
      seen_at: fragment`CASE WHEN ${sameVersion} THEN ${qualified(updateCheck.seen_at)} ELSE excluded.${bare(updateCheck.seen_at)} END`,
    };
    const row = { checked_at: updateCheck.checked_at, news: updateCheck.news, seen_at: updateCheck.seen_at, auto: updateCheck.auto };
    const [written] = await this.#driver.batch([built(BUILD.insert(updateCheck).values(asked).onConflictDoUpdate({ target: updateCheck.id, set: kept }).returning(row))]);
    const now = updateCheckIn(written);
    if (now === undefined) throw new Error("the kept update check did not read back");

    return now;
  }

  async keepAutoStart(start: AutoStart): Promise<void> {
    const auto = JSON.stringify(v.parse(AUTO_START, start));

    await this.#driver.batch([built(BUILD.update(updateCheck).set({ auto }).where(eq(updateCheck.id, 1)))]);
  }

  async readDomainCheck(): Promise<RememberedCheck | undefined> {
    const [read] = await this.#driver.batch([domainCheckAsked()]);

    return domainCheckIn(read);
  }

  async keepDomainCheck(check: DomainCheck, detail: Readonly<Record<string, unknown>> | null, carried?: CarriedUsers, mends: readonly Mend[] = []): Promise<void> {
    const settling = carried === undefined ? [] : [usersCarried(carried, check.ran_at)];
    const entry = detail === null ? [] : [auditPlain({ by: check.by, at: check.ran_at }, "domain_synced", detail)];
    const ended = problemsEnded(mends, check.ran_at);
    await this.#driver.batch([domainCheckKept(check), ...entry, ...settling, ...(ended === undefined ? [] : [ended])]);
  }

  async claimUsers(at: number): Promise<{ readonly logins: readonly Login[] | undefined; readonly mark: number | undefined }> {
    const [, read, kept] = await this.#driver.batch([usersClaimed(at), READ_SETTINGS, domainCheckAsked()]);
    return { logins: settingsIn(read)?.logins, mark: waitingMark(kept?.rows[0]?.users_changed_at) };
  }

  async settleUsers(carried: CarriedUsers, at: number): Promise<{ readonly logins: readonly Login[] | undefined; readonly waits: boolean }> {
    const [, read, kept] = await this.#driver.batch([usersCarried(carried, at), READ_SETTINGS, domainCheckAsked()]);

    return { logins: settingsIn(read)?.logins, waits: waitingMark(kept?.rows[0]?.users_changed_at) !== undefined };
  }

  async claimRules(at: number): Promise<{ readonly settings: SettingValues | undefined; readonly mark: number | null | undefined }> {
    const [, read, kept] = await this.#driver.batch([rulesClaimed(at), READ_SETTINGS, domainCheckAsked()]);
    const row = kept?.rows[0];
    if (row === undefined) return { settings: settingsIn(read), mark: undefined };

    return { settings: settingsIn(read), mark: waitingMark(row.rules_changed_at) ?? null };
  }

  async settleRules(carried: CarriedRules, at: number): Promise<{ readonly waits: boolean; readonly settings: SettingValues | undefined }> {
    const [, read, kept] = await this.#driver.batch([rulesCarried(carried, at), READ_SETTINGS, domainCheckAsked()]);

    return { waits: waitingMark(kept?.rows[0]?.rules_changed_at) !== undefined, settings: settingsIn(read) };
  }

  async readStorageWrites(day: string): Promise<{ readonly writes: number; readonly most: number } | undefined> {
    requireDay(day);
    const [read] = await this.#driver.batch([written(fragment`SELECT (SELECT ${settings.value} FROM ${settings} WHERE ${settings.id} = 1) AS value, ${writesOf(day)} AS writes`)]);
    const stored = settingsIn(read);
    if (stored === undefined) return undefined;

    return { writes: Number(read?.rows[0]?.writes), most: stored.max_storage_writes_per_day };
  }

  async takeStorageWrite(day: string, spare: number): Promise<boolean> {
    requireDay(day);
    requireCount("the writes a day takes beyond its bound", spare);
    // The check and the count are one statement, so no two requests pass the bound together. An install that has stored no settings has no bound.
    const most = fragment`COALESCE((SELECT ${settings.value} ->> 'max_storage_writes_per_day' FROM ${settings} WHERE ${settings.id} = 1), ${NO_BOUND})`;
    const [taken] = await this.#driver.batch([addWrites(day, 1, fragment`${writesOf(day)} < ${most} + ${spare}`)]);

    return changed(taken);
  }

  async addStorageWrites(day: string, writes: number): Promise<void> {
    requireDay(day);
    if (!Number.isSafeInteger(writes) || writes < 1) throw new RangeError(`a count of writes is a whole number of at least 1, not ${writes}`);

    await this.#driver.batch([addWrites(day, writes, fragment`true`)]);
  }

  async readSettings(): Promise<SettingValues | undefined> {
    const [read] = await this.#driver.batch([READ_SETTINGS]);

    return settingsIn(read);
  }

  async readSettingsAndUpdateCheck(): Promise<SettingsAndUpdateCheck> {
    const [stored, update] = await this.#driver.batch([READ_SETTINGS, READ_UPDATE_CHECK]);

    return { settings: settingsIn(stored), updateCheck: updateCheckIn(update) };
  }

  async readFrame(now: number): Promise<FrameRecords> {
    const [yesterday] = daysUpTo(dayOf(now), 2);
    const [stored, domain, update, noted] = await this.#driver.batch([READ_SETTINGS, domainCheckAsked(), READ_UPDATE_CHECK, problemsAsked(yesterday ?? dayOf(now))]);

    return { settings: settingsIn(stored), domainCheck: domainCheckIn(domain), updateCheck: updateCheckIn(update), problems: problemsIn(noted) };
  }

  async initSettings(values: SettingValues, signed: Signed): Promise<{ readonly kind: "done" | "already_set"; readonly values: SettingValues }> {
    const checked = v.parse(SETTING_VALUES, values);
    const noneStored = fragment`NOT EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1)`;
    const [inserted, , read] = await this.#driver.batch([
      insertFrom(settings, [settings.id, settings.value, settings.updated_at], fragment`SELECT 1, ${JSON.stringify(checked)}, ${signed.at} WHERE ${noneStored}`),
      auditPlain(signed, "settings_set", {}),
      READ_SETTINGS,
    ]);
    const stored = settingsIn(read);
    if (stored === undefined) throw new Error("the settings were stored and are not there to read");

    return { kind: changed(inserted) ? "done" : "already_set", values: stored };
  }

  async changeSettings(
    changes: Partial<SettingValues>,
    signed: Signed,
  ): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up" | "signer_gone" | "needs_update_check">> {
    const checked = v.parse(SETTING_CHANGES, changes);
    // A merge patch: each key it names is replaced and every other key stays, only when a value differs.
    const patched = fragment<string>`json_patch(${settings.value}, ${JSON.stringify(checked)})`;
    // Only a change of an update setting can part the two, and such a change writes nothing at all then: every statement of it waits on the pair.
    const fits = checked.update_check === undefined && checked.auto_update === undefined ? undefined : updatePairKept(patched);
    const lands = and(eq(settings.id, 1), signerStands(signed), fits, fragment`json(${patched}) <> json(${settings.value})`);
    const update = built(BUILD.update(settings).set({ value: patched, updated_at: signed.at }).where(lands));
    // The marks of changed users and of changed rules read the settings as they still are, so they run before the change.
    const rules = rulesReplaced(checked, signed, fits);
    // So do the tokens of the users the new logins leave out, which end in the same step.
    const users = checked.logins === undefined ? [] : [usersReplaced(checked.logins, signed, fits), ...endTokensOfDropped(checked.logins, signed, fits)];
    const marks = [...users, ...(rules === undefined ? [] : [rules])];
    // The token that signs ends after the change, where the new logins leave its own user out: it stands for every statement before.
    const own = checked.logins === undefined ? [] : endSignerLeftOut(signed);
    const answers = await this.#driver.batch([...marks, auditOfSettings(signed, checked, lands), update, ...own, settingsAndSigner(signed)]);
    const [updated, read] = [answers[marks.length + 1], answers.at(-1)];
    const values = settingsIn(read);
    if (values === undefined) return { kind: "not_set_up" };

    if (changed(updated)) return { kind: "done", values };

    if (signerGone(read)) return { kind: "signer_gone" };

    const asked = { ...values, ...checked };

    return asked.auto_update && !asked.update_check ? { kind: "needs_update_check" } : { kind: "unchanged", values };
  }

  async addLogin(login: Login, signed: Signed): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up" | "signer_gone">> {
    const email = v.parse(LOGIN, login);
    const added = fragment<string>`json_insert(${settings.value}, '$.logins[#]', ${email})`;
    const add = BUILD.update(settings).set({ value: added, updated_at: signed.at }).where(and(eq(settings.id, 1), signerStands(signed), fragment`NOT ${isStoredLogin(email)}`));
    const entry = auditPlain(signed, "settings_changed", { added: [email], removed: [] });
    const [updated, , , read] = await this.#driver.batch([built(add), entry, usersChanged(signed.at), settingsAndSigner(signed)]);
    const values = settingsIn(read);
    if (values === undefined) return { kind: "not_set_up" };

    if (changed(updated)) return { kind: "done", values };

    return signerGone(read) ? { kind: "signer_gone" } : { kind: "unchanged", values };
  }

  async removeLogin(login: Login, signed: Signed): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up" | "no_working_login" | "signer_gone">> {
    const email = v.parse(LOGIN, login);
    const place = fragment`(SELECT j.key FROM json_each(${settings.value}, '$.logins') AS j WHERE j.value = ${email})`;
    const removed = fragment<string>`json_remove(${settings.value}, '$.logins[' || ${place} || ']')`;
    // A login works when the login page is known to let it in: the signer's own email, or any login for a signer that is none.
    const keepsWorkingLogin = fragment`CASE WHEN ${isStoredLogin(signed.by)} THEN ${login} <> ${signed.by} ELSE json_array_length(${settings.value}, '$.logins') > 1 END`;
    const lands = and(eq(settings.id, 1), signerStands(signed), isStoredLogin(login), keepsWorkingLogin);
    const remove = BUILD.update(settings).set({ value: removed, updated_at: signed.at }).where(lands);
    // The mark of changed users goes first, under the removal's own condition: the tokens of the removed user end right after its audit entry.
    const mark = usersChanged(signed.at, fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${lands})`);
    const entry = auditPlain(signed, "settings_changed", { added: [], removed: [email] });
    const [, updated, , , , read] = await this.#driver.batch([mark, built(remove), entry, ...endTokensOfRemoved(login, signed), settingsAndSigner(signed)]);
    const values = settingsIn(read);
    if (values === undefined) return { kind: "not_set_up" };

    if (changed(updated)) return { kind: "done", values };

    if (signerGone(read)) return { kind: "signer_gone" };

    return values.logins.includes(login) ? { kind: "no_working_login" } : { kind: "unchanged", values };
  }

  async readVisitorKey(): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const [read] = await this.#driver.batch([READ_VISITOR_KEY]);

    return visitorKeyIn(read);
  }

  async readSettingsAndKey(): Promise<SettingsAndKey> {
    const [stored, key] = await this.#driver.batch([READ_SETTINGS, READ_VISITOR_KEY]);

    return { settings: settingsIn(stored), key: visitorKeyIn(key) };
  }

  async ensureVisitorKey(fresh: Uint8Array, at: number): Promise<VisitorKey> {
    const text = visitorKeyToText(fresh);
    // One step whether a key is stored or not: the insert does nothing where one is, and the read after it gives the stored one.
    const noneStored = fragment`NOT EXISTS (SELECT 1 FROM ${secrets} WHERE ${secrets.name} = 'visitor_key')`;
    const first = insertFrom(secrets, [secrets.name, secrets.value, secrets.created_at], fragment`SELECT 'visitor_key', ${text}, ${at} WHERE ${noneStored}`);
    const [inserted, read] = await this.#driver.batch([first, READ_VISITOR_KEY]);
    const key = visitorKeyIn(read);
    if (key === undefined) throw new Error("the visitor key was stored and is not there to read");

    return { kind: changed(inserted) ? "created" : "kept", key };
  }

  async appendAudit(note: AuditNote, signed: Signed): Promise<void> {
    const entry = fragment`VALUES (${signed.at}, ${signed.by}, ${note.action}, ${note.site?.id ?? null}, ${note.site?.name ?? null}, ${JSON.stringify(note.detail)})`;
    await this.#driver.batch([insertFrom(audit, AUDIT_COLUMNS, entry)]);
  }

  async noteLogin(login: Login, entered: { readonly since: number; readonly at: number }): Promise<{ readonly kind: "written" | "known" }> {
    // The kind stands in the statement itself, as below: the question reads the one entry of this email the index of the logins leads to.
    const known = fragment`EXISTS (SELECT 1 FROM ${audit} WHERE ${audit.action} = 'login' AND ${audit.actor} = ${login} AND ${audit.at} >= ${entered.since})`;
    const [added] = await this.#driver.batch([insertFrom(audit, PLAIN_AUDIT_COLUMNS, fragment`SELECT ${entered.at}, ${login}, 'login', '{}' WHERE NOT ${known}`)]);

    return { kind: changed(added) ? "written" : "known" };
  }

  async hasLoggedIn(): Promise<boolean> {
    const [read] = await this.#driver.batch([everLoggedInAsked()]);

    return read?.rows[0]?.found === 1;
  }

  async listAudit(query: AuditQuery): Promise<readonly AuditEntry[]> {
    requireAuditPage(query.limit);

    const [listed] = await this.#driver.batch([auditListAsked(query, AUDIT_START[query.dir ?? "desc"], false)]);

    return (listed?.rows ?? []).map(auditFromRow);
  }

  async searchAudit(query: AuditSearch): Promise<AuditFound> {
    requireAuditPage(query.limit);

    const [ends, found] = await this.#driver.batch([auditEndsAsked(), auditSearchAsked(query, false)]);
    const entries = (found?.rows ?? []).map(auditFromRow);

    return { entries, stoppedAt: entries.length < query.limit ? auditStopIn(ends, query) : undefined };
  }

  async listNamedAudit(query: AuditQuery): Promise<readonly NamedAuditEntry[]> {
    requireAuditPage(query.limit);

    const [listed] = await this.#driver.batch([auditListAsked(query, AUDIT_START[query.dir ?? "desc"], true)]);

    return namedAuditIn(listed);
  }

  async searchNamedAudit(query: AuditSearch): Promise<NamedAuditFound> {
    requireAuditPage(query.limit);

    const [ends, found] = await this.#driver.batch([auditEndsAsked(), auditSearchAsked(query, true)]);
    const entries = namedAuditIn(found);

    return { entries, stoppedAt: entries.length < query.limit ? auditStopIn(ends, query) : undefined };
  }

  async countAudit(query: AuditCountQuery): Promise<AuditCount> {
    const [counted] = await this.#driver.batch([auditCountAsked(query)]);

    return auditCountIn(counted);
  }

  async endOfAuditPart(query: AuditPartQuery): Promise<number | undefined> {
    const [found] = await this.#driver.batch([auditPartEndAsked(query, AUDIT_START.desc)]);

    return auditPartEndIn(found);
  }

  async addRequests(counted: CountedRequests): Promise<RequestCounts> {
    requireDay(counted.day);
    if (!Number.isSafeInteger(counted.requests) || counted.requests < 1) throw new RangeError(`requests are counted in whole numbers from 1, not ${counted.requests}`);

    const views = counted.views ?? 0;
    if (!Number.isSafeInteger(views) || views < 0 || views > counted.requests) throw new RangeError(`views are counted in whole numbers from 0 to the requests, not ${views}`);

    const rows = counted.rows ?? NO_ROWS;
    requireCount("the rows read", rows.read);
    requireCount("the rows written", rows.written);

    const [site, all] = await this.#driver.batch([
      addRequests({ day: counted.day, site: counted.site, requests: counted.requests, views, rows: NO_ROWS }),
      addRequests({ day: counted.day, site: ALL_SITES, requests: counted.requests, views, rows }),
    ]);

    return { site: requestsIn(site), all: requestsIn(all) };
  }

  async readViews(sites: readonly SiteId[], day: string): Promise<ReadonlyMap<SiteId, SiteViews>> {
    requireDay(day);
    if (sites.length > MOST_SITES_ASKED) throw new RangeError(`the views of at most ${MOST_SITES_ASKED} sites are read at once, not of ${sites.length}`);

    const views = new Map<SiteId, SiteViews>(sites.map((site) => [site, { today: 0, week: 0 }]));
    if (sites.length === 0) return views;

    // A site named twice is read once: its rows would be summed once for each naming.
    // Every row is found by its key: each site named is joined to each day of the week.
    const named = fragment`json_each(${JSON.stringify([...views.keys()])}) AS s CROSS JOIN json_each(${JSON.stringify(viewDays(day))}) AS d`;
    const sums = fragment`${A_COUNT.site} AS site, SUM(${A_COUNT.views}) AS week, SUM(CASE WHEN ${A_COUNT.day} = ${day} THEN ${A_COUNT.views} ELSE 0 END) AS today`;
    const counted = fragment`SELECT ${sums} FROM ${named} JOIN ${requestCounts} AS ${A_COUNT} ON ${A_COUNT.day} = d.value AND ${A_COUNT.site} = s.value GROUP BY ${A_COUNT.site}`;
    const [read] = await this.#driver.batch([written(counted)]);
    for (const row of read?.rows ?? []) views.set(row.site as SiteId, { today: Number(row.today), week: Number(row.week) });

    return views;
  }

  async readDailyViews(sites: readonly SiteId[], day: string, count: number): Promise<CountedViews> {
    requireDay(day);
    if (sites.length > MOST_SITES_COMPARED) throw new RangeError(`the views of at most ${MOST_SITES_COMPARED} sites are read day by day at once, not of ${sites.length}`);

    const days = daysUpTo(day, count);
    // A site named twice is read once.
    const asked = [...new Set(sites)];

    return dailyViewsIn(await this.#driver.batch([...dailyViewsAsked([ALL_SITES, ...asked], days)]), sites, days);
  }

  async readWeeklyViews(sites: readonly SiteId[], day: string, count: number): Promise<CountedViews> {
    requireDay(day);
    if (sites.length > MOST_SITES_COMPARED) throw new RangeError(`the views of at most ${MOST_SITES_COMPARED} sites are read week by week at once, not of ${sites.length}`);

    const weeks = weeksUpTo(day, count);
    // A site named twice is read once.
    const asked = [...new Set(sites)];

    return weeklyViewsIn(await this.#driver.batch([...weeklyViewsAsked([ALL_SITES, ...asked], weeks)]), sites, weeks);
  }

  async readDayUse(day: string): Promise<DayUse> {
    requireDay(day);
    const columns = { requests: requestCounts.requests, rows_read: requestCounts.rows_read, rows_written: requestCounts.rows_written };
    const [read] = await this.#driver.batch([built(BUILD.select(columns).from(requestCounts).where(and(eq(requestCounts.day, day), eq(requestCounts.site, ALL_SITES))))]);
    const row = read?.rows[0];

    return { requests: Number(row?.requests ?? 0), rows: { read: Number(row?.rows_read ?? 0), written: Number(row?.rows_written ?? 0) } };
  }

  async readRequests(day: string, site?: SiteId): Promise<RequestCounts> {
    requireDay(day);
    const ofSite = site === undefined ? [] : [requestsOf(day, site)];
    const read = await this.#driver.batch([requestsOf(day, ALL_SITES), ...ofSite]);

    return { site: requestsIn(read[1]), all: requestsIn(read[0]) };
  }

  /** Move the live site with an id to the trash while a further condition holds for it, with its audit entry: whether it moved, and the read of the site after. */
  async #trashWhere(holds: SQL | undefined, id: SiteId, signed: Signed): Promise<{ readonly moved: boolean; readonly after: StatementResult | undefined }> {
    const [updated, , after] = await this.#driver.batch([...trashing(holds, id, signed), siteById(id)]);

    return { moved: changed(updated), after };
  }

  /** Remove the site with an id for good while a condition holds for it, with its audit entry; `undefined` when it does not hold. */
  async #deleteWhere(holds: SQL | undefined, id: SiteId, signed: Signed): Promise<Done | undefined> {
    const [before, , deleted] = await this.#driver.batch(deletion(holds, id, signed));

    return changed(deleted) ? done(before) : undefined;
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
