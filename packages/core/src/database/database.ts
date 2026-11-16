// Everything poplin keeps in its database, as the operations the rest of the code asks for. No SQL and no row leaves this interface.
//
// Every change names who made it and when, and writes its audit entry in the same atomic step: both are kept, or neither.
//
// An implementation keeps these rules itself, whatever it stores records in: a site always holds its live version, no two sites share a folder,
// and no site's public name is any site's id. The cases every implementation runs are in `tests/database/support/database-contract.ts`.

import type { ComputerLogin, LoginId, PendingLogin, UserCode } from "../auth/computer-logins";
import type { Login } from "../auth/logins";
import type { EndedToken, TokenId, TokenRecord } from "../auth/tokens";
import type { PublicName, SiteName } from "../names/names";
import type { AuditAction, AuditEntry } from "../records/audit";
import type { DomainCheck, RememberedCheck } from "../records/domain-check";
import type { Holder } from "../records/fields";
import type { Problem } from "../records/problem";
import type { SiteId } from "../sites/ids";
import type { UpdateAddress } from "../records/secret";
import type { SettingValues } from "../records/settings";
import type { Site, SiteAccess, SiteFolder } from "../records/site";
import type { SweepPlace } from "../records/sweep-place";
import type { Totals } from "../records/sizes";
import type { AutoStart, UpdateCheck } from "../records/update";
import type { VersionContents } from "../records/version-contents";
import type { ManifestFile, Upload, UploadId, UploadPlan } from "../records/upload";
import type { DailyViews, SiteViews } from "../records/views";
import type { ProblemNote } from "./problems";

/** How many entries of the audit log, counted by `seq`, one narrowed reading looks at before it stops. */
export const AUDIT_WINDOW = 5000;

/** What a site is called now. */
export interface SiteNamed {
  /** Its name. */
  readonly name: SiteName;

  /** The title a listing shows it under: the typed one, else its page's own; `null` for a site with neither. */
  readonly title: string | null;
}

/** The site an id names, as it is now: the one that has the id, or the one that gave it up at a new link. */
export interface SiteNow extends SiteNamed {
  /** The id it has now. */
  readonly id: SiteId;
}

/** Who makes a change and when, in milliseconds since the epoch. */
export interface Signed {
  readonly by: Holder;
  readonly at: number;
}

/**
 * What a new site is made from.
 *
 * `folder` is minted by the caller, so the site's files can be stored before the site is. `embeddable` is `true` when left out.
 * `title` is the one typed, and `page_title` the entry page's own, left out for a page with none.
 *
 * `bytes` is the sum of the sizes of the files of version 1 and `files` their count, both whole numbers from 0 up.
 */
export type NewSite = {
  readonly name: SiteName;
  readonly folder: SiteFolder;
  readonly title: string | null;
  readonly page_title?: string;
  readonly search_engines: boolean;
  readonly embeddable?: boolean;
  readonly expires: "never" | number;
  readonly bytes: number;
  readonly files: number;
} & SiteAccess;

/** The settings of a site that change on their own; a key left out stays as it is. `name` renames the site, whatever other sites are called. `title` is the typed title, and `null` takes it away, which leaves the page's own to show. */
export interface SiteDetails {
  readonly name?: SiteName;
  readonly title?: string | null;
  readonly search_engines?: boolean;
  readonly embeddable?: boolean;
  readonly expires?: "never" | number;
}

/** A site an address serves, its `versions` holding the live one alone, with what that version is known to hold. */
export interface ServedSite {
  readonly site: Site;
  readonly contents: VersionContents;
}

/** What a lookup for serving reads beside the site, in its own step. */
export interface ServedAlso {
  /** The site and the UTC day whose request counts are read. */
  readonly counts?: { readonly day: string; readonly site: SiteId };

  /** Whether the settings and the signing key are read. */
  readonly settingsAndKey?: boolean;
}

/** What a lookup for serving found, and what it read beside the site. */
export interface ServedLookup {
  /** The site the address serves, as `findServed` gives it. */
  readonly served: ServedSite | undefined;

  /** The day's counts as `readRequests` gives them, when they were asked for. */
  readonly counts?: RequestCounts;

  /** The settings and the signing key as `readSettingsAndKey` gives them, when they were asked for. */
  readonly settingsAndKey?: SettingsAndKey;
}

/** Where a visitor's hostname points: a site's id, or a public name. */
export type Address = { readonly id: SiteId } | { readonly public_name: PublicName };

/**
 * Where a page of a listing ended: the id of its last site, and the moment it is listed by. For a site that is when its content last changed, by a publish or by another version made live; for one in the trash, when it went there.
 *
 * A listing sorted by name also carries the last site's `name`, one sorted by access its `access`, and one sorted by title, as `title`, the key that site is ordered by.
 * The page after it starts behind that, and a listing asked without it throws `RangeError`.
 */
interface SitesCursor {
  readonly updated_at: number;
  readonly id: SiteId;
  readonly name?: string;
  readonly access?: SiteAccess["access"];
  readonly title?: string;
}

/** Which sites a listing holds. */
export interface SitesQuery {
  /** `true` lists the trash, `false` the sites outside it. */
  readonly trash: boolean;

  /** Only the sites this holder made; every site when absent. */
  readonly owner?: Holder;

  /** The most sites one page holds, from 1 to 100. */
  readonly limit: number;

  /** The `next` of the page before; absent for the first page. */
  readonly after?: SitesCursor;

  /** Only the sites whose name holds this text, or whose title does: the typed one, else the page's own; or whose public name does. Every site when absent. */
  readonly named?: string;

  /** Only the sites of this access; every site when absent. */
  readonly access?: SiteAccess["access"];

  /** Only the sites that delete themselves on a set day, or only those that never do; every site when absent. */
  readonly expires?: "set" | "never";

  /** What the listing is ordered by: the last change when absent, the name, the access from private to public, or the listed title (typed, else the page's, else the name) by its first 40 characters, capitals aside. Sites alike follow their ids. */
  readonly sort?: "updated" | "name" | "access" | "title";

  /** The direction: `desc` for the last change when absent, `asc` for a name, an access and a title. */
  readonly dir?: "asc" | "desc";
}

/** One page of a listing, the site whose content changed last first, or of the trash the site deleted last first; of sites listed by one moment the one with the greater id comes first. `next` is absent on the last page. */
export interface SitesPage {
  readonly sites: readonly Site[];
  readonly next?: SitesCursor;
}

/** What a screen that lists sites reads beside them. */
export interface SitesShown {
  /** The UTC day, such as `2026-11-13`, that the views of each site are read up to: that day and the six before it. */
  readonly day: string;

  /** Whether the note of each token that published a kept version is read. */
  readonly publishers: boolean;
}

/** One page of sites with what a screen shows beside them. */
export interface ShownSitesPage extends SitesPage {
  /** The install's settings, `undefined` before setup stored them. */
  readonly settings: SettingValues | undefined;

  /** The page views of every site of the page, zeros where nothing was counted. */
  readonly views: ReadonlyMap<SiteId, SiteViews>;

  /** The note of each token that published a kept version of a site of the page and has a note, removed or not; empty when none were asked for. */
  readonly publishers: ReadonlyMap<TokenId, string>;
}

/** One site with what a screen shows beside it. */
export interface ShownSite extends SettingsAndSite {
  /** The site's page views, zeros where nothing was counted or no site has the id. */
  readonly views: SiteViews;

  /** The note of each token that published a kept version of the site and has a note, removed or not; empty when none were asked for. */
  readonly publishers: ReadonlyMap<TokenId, string>;
}

/** Which sites a sweep is due to act on: the live ones whose expiry is at or before a moment, or the ones that went to the trash at or before a moment. */
export type DueSites = { readonly expiredBy: number } | { readonly trashedBy: number };

/** What a scheduled run starts from, as one read gave it; each is `undefined` where its own read gives that. */
export interface SweepStart {
  readonly updateCheck: UpdateCheck | undefined;
  readonly settings: SettingValues | undefined;
  readonly place: SweepPlace | undefined;
}

/** What a site is made with beside its record: what its first version holds, and the site it is a copy of. */
export interface MadeWith {
  readonly contents?: VersionContents;
  readonly copiedFrom?: SiteId;
}

/** One page of every site, the trash included, in ascending order of id. `next` is the id to pass as `after`, absent on the last page. */
export interface ExportPage {
  readonly sites: readonly Site[];
  readonly next?: SiteId;
}

/** A publish as `addVersion` takes it. */
export interface NewVersion {
  /** The number `reserveVersion` set aside. */
  readonly number: number;

  /** How many versions the site keeps at most, the live one included. */
  readonly keep: number;

  /** The sum of the sizes of the version's files. */
  readonly bytes: number;

  /** How many files the version holds. */
  readonly files: number;

  /** What the version holds; nothing is known of it when left out. */
  readonly contents?: VersionContents;
}

/** The signing key and whether this call stored it. `kept` is a key that was already there, which is the one to use. */
export interface SigningKey {
  readonly kind: "created" | "kept";
  readonly key: Uint8Array<ArrayBuffer>;
}

/** The settings and the bytes of the signing key as one read gave them; each is `undefined` before it was stored. */
export interface SettingsAndKey {
  readonly settings: SettingValues | undefined;
  readonly key: Uint8Array<ArrayBuffer> | undefined;
}

/** The settings and one site as one read gave them: the settings are `undefined` before setup stored them, the site when no site has the id. */
export interface SettingsAndSite {
  readonly settings: SettingValues | undefined;
  readonly site: Site | undefined;
}

/** What the frame around every screen of the dashboard is drawn from, as one read gave it; each is `undefined` where its own read gives that. `problems` are those of the UTC day of the reading and of the day before, the one last seen first. */
export interface FrameRecords {
  readonly settings: SettingValues | undefined;
  readonly updateAddress: UpdateAddress | undefined;
  readonly domainCheck: RememberedCheck | undefined;
  readonly updateCheck: UpdateCheck | undefined;
  readonly problems: readonly Problem[];
}

/** The change was made; `site` is the site after it. */
export interface Done {
  readonly kind: "done";
  readonly site: Site;
}

/** The site already was as asked: nothing was written, no audit entry either. */
export interface Unchanged {
  readonly kind: "unchanged";
  readonly site: Site;
}

/** The change was refused for `kind`: nothing was written, no audit entry either. */
export interface Refused<Reason extends string> {
  readonly kind: Reason;
}

/** A version number set aside for a publish. */
export interface Reserved {
  readonly kind: "reserved";
  readonly number: number;
}

/** A publish that went live. `dropped` lists the versions no longer kept, whose files the caller removes. */
export interface Published extends Done {
  readonly dropped: readonly number[];
}

/** What a staged publish is recorded from when it begins. `number` is 1 for a new site, and otherwise the number `reserveVersion` set aside. */
export interface NewUpload {
  readonly id: UploadId;
  readonly folder: SiteFolder;
  readonly number: number;
  readonly owner: Holder;
  readonly plan: UploadPlan;
  readonly manifest: readonly ManifestFile[];
  readonly created_at: number;
}

/** What a pending upload is published with: the settings asked with it, which change with the version or not at all. */
export interface UploadedVersion {
  /** How many versions the site keeps at most, the live one included. */
  readonly keep: number;

  /** The access to set; absent to leave it as it is. */
  readonly access?: SiteAccess;

  /** The details to set; a key left out stays as it is. */
  readonly details: SiteDetails;

  /** The title of the version's entry page, which replaces the one of the version before; left out for a page with none. */
  readonly page_title?: string;

  /** What the version holds, worked out from the upload's manifest; nothing is known of it when left out. */
  readonly contents?: VersionContents;
}

/** The room a new upload must fit in. Each bound is checked with the upload itself counted, in the same step that records it. */
export interface UploadRoom {
  /** The most uploads its owner may have pending. */
  readonly own: number;

  /** The most bytes its folder may hold once it is live: the site's newest `staying` versions and every pending upload under the folder. */
  readonly folderBytes: number;

  /** How many of the folder's site's newest kept versions stay beside a new one. */
  readonly staying: number;

  /** The most bytes every kept version of every site and every pending upload may hold together. */
  readonly totalBytes: number;

  /** The most sites, the pending uploads of new sites counted as sites; `null` for no bound, as for an upload that makes no site. */
  readonly sites: number | null;

  /** The UTC day the upload's files are counted on, such as `2026-11-13`. */
  readonly day: string;

  /** The most files every upload begun on that day may declare together. An upload that is given up gives none back. */
  readonly dayFiles: number;

  /** How many times the upload writes to the store: once for each file it declares, and twice for each file of a copy, which is read and then written. They are counted on that day, when the upload begins. */
  readonly writes: number;

  /** The most times the store may be written to or listed on that day, the upload's own writes counted. */
  readonly dayWrites: number;
}

/** Where a page of old uploads ended. */
interface UploadsCursor {
  readonly created_at: number;
  readonly id: UploadId;
}

/** One page of uploads, the oldest first. `next` is absent on the last page. */
export interface UploadsPage {
  readonly uploads: readonly Upload[];
  readonly next?: UploadsCursor;
}

/** One page of the folders removed sites left behind, in ascending order. `next` is the folder to pass as `after`, absent on the last page. */
export interface LeftoversPage {
  readonly folders: readonly SiteFolder[];
  readonly next?: SiteFolder;
}

/** How many logins may wait at one moment. */
export interface LoginRoom {
  /** The most waiting logins of one visitor. */
  readonly perVisitor: number;

  /** The most waiting logins of all visitors together. */
  readonly all: number;
}

/** What an admin decides about a pending login, and when. */
export interface LoginDecision {
  /** Whether the computer is let in. */
  readonly state: "allowed" | "denied";

  /** Whether an allowed computer becomes a publisher whatever it asked to be. Left out, it becomes what it asked: a decision never gives more. */
  readonly asPublisher?: boolean;

  /** The admin who decides, whose email signs the audit entry. */
  readonly by: Login;

  /** The clock, in milliseconds since the epoch: a login that ran out by then is not decided. */
  readonly at: number;
}

/** Which entries of the audit log one page holds. */
export interface AuditQuery {
  /** The most entries one page holds, from 1 to 1,000. */
  readonly limit: number;

  /** The `seq` of the entry the page before ended on; absent for the first page. */
  readonly after?: number;

  /** The direction: `desc`, the newest first, when absent; `asc` is the oldest first. */
  readonly dir?: "asc" | "desc";
}

/** Which entries of the audit log a narrowed reading asks for: a page of those a narrowing keeps. */
export interface AuditSearch extends AuditQuery {
  /** Only the entries of these actions; every entry when absent. */
  readonly actions?: readonly AuditAction[];

  /** Only the entries about a site this text finds: one whose name then held it, or that holds it now in its name, its listed title, or its public name, whatever the case of its letters A to Z; every entry when absent. */
  readonly site?: string;

  /** Only the entries of the one site that has this id or once had it, those from before a new link among them; of a site gone for good, the entries that hold this very id. Every entry when absent. */
  readonly of?: SiteId;
}

/** What a narrowed reading of the audit log found. */
export interface AuditFound {
  /** The entries the narrowing keeps, in the direction asked. */
  readonly entries: readonly AuditEntry[];

  /** Where the reading stopped with fewer entries than asked and the log going on: the `after` the next reading takes. `undefined` for a full page, and where the log ends. */
  readonly stoppedAt: number | undefined;
}

/** An entry of the audit log with what it names, as that is now. */
export interface NamedAuditEntry {
  /** The entry as the log holds it. */
  readonly entry: AuditEntry;

  /** The site the entry is about, as it is now: the one that has the id the entry holds, or the one that gave it up at a new link. `null` for an entry about no site, and once the site is gone for good. */
  readonly site: SiteNow | null;

  /** The note of the token that did it, removed or not; `null` for a login, and for a token with no note. */
  readonly tokenNote: string | null;
}

/** What a narrowed reading of the audit log found, each entry with what it names. */
export interface NamedAuditFound extends Pick<AuditFound, "stoppedAt"> {
  /** The entries the narrowing keeps, in the direction asked. */
  readonly entries: readonly NamedAuditEntry[];
}

/** Which entries of the audit log a count is of, and how far into the log it reads. */
export interface AuditCountQuery {
  /** How many entries the count reads at the most, from the newest back; at least 1. */
  readonly most: number;

  /** Only the entries of these actions; every entry when absent. */
  readonly actions?: readonly AuditAction[];

  /** Only the entries about a site this text finds: one whose name then held it, or that holds it now in its name, its listed title, or its public name, whatever the case of its letters A to Z; every entry when absent. */
  readonly site?: string;

  /** Only the entries of the one site that has this id or once had it, those from before a new link among them; of a site gone for good, the entries that hold this very id. Every entry when absent. */
  readonly of?: SiteId;
}

/** Which part of the audit log is asked about: the entries behind a place, the newest first, as many as a file of the log holds. */
export interface AuditPartQuery {
  /** How many entries the part holds; at least 1. */
  readonly entries: number;

  /** The `seq` of the entry the part before ended on; absent for the first part. */
  readonly after?: number;
}

/** How many entries of the audit log a count found. */
export interface AuditCount {
  /** The entries found among those read. */
  readonly count: number;

  /** Whether the count read the log to its oldest entry: `count` is then exact, and otherwise the least it can be, since the log goes on. */
  readonly whole: boolean;
}

/** An entry for the audit log that goes with no change, such as a login. */
export interface AuditNote {
  readonly action: AuditAction;
  readonly site?: { readonly id: SiteId; readonly name: SiteName };
  readonly detail: Readonly<Record<string, unknown>>;
}

/** The requests one UTC day has counted. */
export interface RequestCounts {
  /** The requests of the one site asked about. */
  readonly site: number;

  /** The requests of all sites together. */
  readonly all: number;
}

/** Rows of the database: how many it read, and how many it wrote. */
export interface RowsUsed {
  readonly read: number;
  readonly written: number;
}

/** What one UTC day has counted for all sites together: the requests, and the rows the database read and wrote as far as they were counted. */
export interface DayUse {
  readonly requests: number;
  readonly rows: RowsUsed;
}

/** Requests to add to a day's counts. */
export interface CountedRequests {
  /** The UTC date, such as `2026-11-13`. */
  readonly day: string;

  /** The site that answered them. */
  readonly site: SiteId;

  /** How many: a whole number of at least 1. */
  readonly requests: number;

  /** How many of them opened a page: a whole number from 0 to `requests`, and 0 when left out. */
  readonly views?: number;

  /** The rows the database read and wrote since they were last added to a day: whole numbers from 0, and none when left out. They are added to the day of all sites alone. */
  readonly rows?: RowsUsed;
}

/** The tokens at a moment: the ones that work, and the newest that ended. */
export interface TokenStates {
  /** Every token that works, the newest first, and of tokens made at one moment the one with the greater id. */
  readonly live: readonly TokenRecord[];

  /** The tokens that were removed or ran out, the one that ended last first. */
  readonly ended: readonly EndedToken[];

  /** Whether more tokens ended than `ended` holds. */
  readonly more: boolean;
}

/** The one doorway to stored sites, tokens, pending logins, settings, the signing key, the audit log, and the request counts of the last year. */
export interface Database {
  /**
   * Make a site under a fresh id, with version 1 as its only version and its live one: published at `signed.at` by `signed.by`, of the draft's `bytes` and `files`.
   *
   * @returns the site, or `name_taken` when it is to be public and another site holds the public name or has it as its id, whatever its folder
   * @param contents - what version 1 holds; nothing is known of it when left out
   * @throws {Error} the draft breaks a field rule, or its folder is a site's, in the trash or not; nothing is stored
   */
  createSite(draft: NewSite, signed: Signed, contents?: VersionContents): Promise<Done | Refused<"name_taken">>;

  /** The site with this id, in the trash or not. */
  getSite(id: SiteId): Promise<Site | undefined>;

  /** The settings and the site with this id, in the trash or not, read together in one step: what an action on one site starts from. */
  getSiteWithSettings(id: SiteId): Promise<SettingsAndSite>;

  /**
   * The settings and the site with this id, in the trash or not, with its views and who published its versions, all read in one step.
   *
   * @returns what `getSiteWithSettings` gives and, beside it, what `readViews` and `getTokenNames` give for the site
   * @throws {RangeError} `day` is not a date
   */
  getShownSite(id: SiteId, shown: SitesShown): Promise<ShownSite>;

  /**
   * The name each of these ids' sites has now and the title it is listed under, in the trash or not, read in one step. An id that is no site's is left out.
   *
   * @param ids - the sites to name, at most 100 different ones
   * @throws {RangeError} more than 100 different ids are asked for
   */
  getSiteNames(ids: readonly SiteId[]): Promise<ReadonlyMap<SiteId, SiteNamed>>;

  /**
   * The site each of these ids belonged to before a new link, as it is now, in the trash or not, read in one step however many new links lie between. An id no site gave up, or one whose site is deleted, is left out.
   *
   * @param ids - the ids to look up, at most 100 different ones
   * @throws {RangeError} more than 100 different ids are asked for
   */
  getLaterSites(ids: readonly SiteId[]): Promise<ReadonlyMap<SiteId, SiteNow>>;

  /** The site holding this public name, in the trash or not. */
  getSiteByPublicName(name: PublicName): Promise<Site | undefined>;

  /**
   * The site an address serves at `now`.
   *
   * @returns the site with its live version alone, and what that version holds; `undefined` for an address of no site, of a site in the trash, or of a site past its expiry
   */
  findServed(address: Address, now: number): Promise<ServedSite | undefined>;

  /**
   * Find the site an address serves and, in the same one step, read what a request for it needs beside it: a day's request counts, the settings and the signing key, or neither.
   *
   * @throws {RangeError} the day of the counts is not a date such as `2026-11-13`
   */
  findServedWith(address: Address, now: number, also: ServedAlso): Promise<ServedLookup>;

  /**
   * One page of the sites, or of the trash.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to 100
   */
  listSites(query: SitesQuery): Promise<SitesPage>;

  /**
   * One page of the sites, or of the trash, with the settings, the views of each site, and who published its versions, all read in one step.
   *
   * @returns the page `listSites` gives for the query, and beside it what `readSettings`, `readViews`, and `getTokenNames` give
   * @throws {RangeError} `limit` is not a whole number from 1 to 100, or `day` is not a date
   */
  listShownSites(query: SitesQuery, shown: SitesShown): Promise<ShownSitesPage>;

  /** Set who may open a site. Going public claims the public name; leaving public frees it. `name_taken` as in `createSite`. */
  changeAccess(id: SiteId, access: SiteAccess, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">>;

  /**
   * Set a site's name, title, search-engines flag, embeddable flag, or expiry. A new name changes neither the id nor the public name.
   *
   * @throws {Error} a value breaks its field rule
   */
  changeDetails(id: SiteId, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash">>;

  /**
   * Set who may open a site and its details together, in one step: the details change only once the site has the access asked, so a refused access leaves all of it as it was.
   * Each of the two that changes writes its own audit entry.
   *
   * @returns `unchanged` when the site already has the access and the details; the refusals as in `changeAccess`
   * @throws {Error} a detail breaks its field rule
   */
  changeAccessAndDetails(id: SiteId, access: SiteAccess, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">>;

  /** Give a site a new id. The old id names no site from then on, and is kept as an earlier id of the site; the public name, the folder, the request counts of the year up to `signed.at`, and everything else stay with the site. */
  giveNewId(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">>;

  /** Move a site into the trash. It keeps its public name. */
  trashSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">>;

  /**
   * The ids of the sites a sweep is due to act on, the one due longest first, each found through an index: a site that is not due costs nothing.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to 100
   */
  listDueSites(due: DueSites, limit: number): Promise<readonly SiteId[]>;

  /**
   * Move a site into the trash only while it is live and its expiry is at or before `signed.at`: the check and the move are one step.
   *
   * @returns `not_due` for a site that is gone, in the trash already, or given a later expiry or none
   */
  trashExpiredSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_due">>;

  /** Take a site out of the trash. An expiry that is not after `signed.at` becomes `"never"` in the same step, so the site is served again and no sweep trashes it for that expiry. */
  restoreSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "not_in_trash">>;

  /**
   * Remove a site for good, from the trash or not. Its public name is free again, and its folder is a leftover from the same step on.
   *
   * @returns `site` is the site as it was, whose folder the caller empties and then forgets
   */
  deleteSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found">>;

  /**
   * Remove a site for good, as `deleteSite` does, only while it sits in the trash since `trashedBy` or before: the check and the removal are one step.
   *
   * @returns `not_due` for a site that is gone, was restored, or went to the trash later
   */
  deleteSatOutSite(id: SiteId, signed: Signed, trashedBy: number): Promise<Done | Refused<"not_due">>;

  /**
   * One page of the leftovers: the folders of removed sites that are not known to be empty. A folder a site is stored into again is no leftover.
   *
   * @param query - how many folders, from 1 to 100, and the `next` of the page before
   * @throws {RangeError} `limit` is not a whole number from 1 to 100
   */
  listLeftovers(query: { readonly limit: number; readonly after?: SiteFolder }): Promise<LeftoversPage>;

  /** Forget a leftover, once the bucket holds nothing under the folder. A folder that is none changes nothing. */
  forgetLeftover(folder: SiteFolder): Promise<void>;

  /** Set aside the next version number of a site. No two calls get the same number; a number never used is simply skipped. It writes no audit entry: nothing a reader of the site sees has changed. */
  reserveVersion(id: SiteId): Promise<Reserved | Refused<"not_found" | "in_trash">>;

  /**
   * Record a publish under a reserved number and make it live. The page's title stays as the version before left it.
   *
   * @returns `stale_number` when the number was not reserved or a higher version is already kept
   * @throws {RangeError} `keep` is not a whole number from 1 up, or `bytes` or `files` is not a whole number from 0 up
   */
  addVersion(id: SiteId, version: NewVersion, signed: Signed): Promise<Published | Refused<"not_found" | "in_trash" | "stale_number">>;

  /**
   * Make a kept version the live one.
   *
   * @param target - the version's number, or `"previous"` for the highest kept version below the live one
   */
  setLiveVersion(id: SiteId, target: number | "previous", signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "no_such_version">>;

  /** How many sites the install has and what all their kept versions hold: at every moment the counts and sums over every site, the trash included. */
  readTotals(): Promise<Totals>;

  /**
   * One page of every site as it is stored, for a backup. Tokens, the signing key, and the audit log are in no page.
   *
   * @param query - how many sites, from 1 to 100, and the `next` of the page before
   * @throws {RangeError} `limit` is not a whole number from 1 to 100
   */
  exportSites(query: { readonly limit: number; readonly after?: SiteId }): Promise<ExportPage>;

  /**
   * Store a pending upload's site from a backup exactly as it was exported, and mark the upload finished, in one step: its id, folder, access, versions, owner, times, and place in or out of the trash.
   *
   * The site and all its versions are stored together or not at all, with one `imported` audit entry. Version numbers go on from above its highest kept version.
   *
   * @param site - the site, whose folder is the upload's; `contents` says what each of its versions holds, by the version's number, and nothing is known of a version left out
   * @returns the first of these that holds: `not_pending` when the upload is finished, abandoned, gone, or of another folder; `id_taken` when a site has the id as its id or its public name; `folder_taken` when a site has the folder;
   *   `name_taken` as in `createSite` or when the public name is the site's own id. Every refusal but `not_pending` leaves the upload pending
   * @throws {Error} the value is no site
   */
  importUploadAsSite(id: UploadId, site: Site, signed: Signed, contents?: ReadonlyMap<number, VersionContents>): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken" | "not_pending">>;

  /** The site whose files sit under this folder, in the trash or not. */
  getSiteByFolder(folder: SiteFolder): Promise<Site | undefined>;

  /**
   * Record a staged publish as pending, only while it fits the room it is given. It writes no audit entry: nothing a reader of any site sees has changed.
   *
   * The files it declares and the writes it makes are added to the counts of its day in the same step.
   *
   * @returns the first bound the upload does not fit, in the order `own`, `folder`, `total`, `sites`, `day`, `writes`; of uploads recorded at the same moment only those that fit together are kept.
   * `left` is how much of the day's bound was still free: files for `day_full`, writes for `writes_full`, and 0 for a day that is used up
   * @throws {Error} a value breaks its field rule, the manifest is empty or names a path twice, or the id or the folder and number are already an upload's
   */
  addUpload(
    upload: NewUpload,
    room: UploadRoom,
  ): Promise<{ readonly kind: "done" } | Refused<"own_full" | "folder_full" | "total_full" | "sites_full"> | (Refused<"day_full" | "writes_full"> & { readonly left: number })>;

  /** The upload with this id and its manifest, which is empty once the upload is finished or abandoned. */
  getUpload(id: UploadId): Promise<{ readonly upload: Upload; readonly manifest: readonly ManifestFile[] } | undefined>;

  /** The upload with this id and the one file of its manifest at `path`, `undefined` when the manifest names none there. The manifest itself is not read out. */
  getUploadFile(id: UploadId, path: string): Promise<{ readonly upload: Upload; readonly file: ManifestFile | undefined } | undefined>;

  /**
   * Make a pending upload's site, at version 1 under a fresh id, and mark the upload finished, in one step. The site belongs to whoever began the upload, whoever finishes it.
   *
   * @param draft - the site, whose folder is the upload's
   * @param made - `contents` is what version 1 holds, worked out from the upload's manifest; nothing is known of it when left out.
   *   `copiedFrom` is the site a copy was made of: it writes one `duplicate` audit entry more about the new site, in the same step
   * @returns `not_pending` when the upload is finished, abandoned, gone, or of another folder; `name_taken` as in `createSite`
   * @throws {Error} the draft breaks a field rule, or its folder is already a site's
   */
  publishUploadAsSite(id: UploadId, draft: NewSite, signed: Signed, made?: MadeWith): Promise<Done | Refused<"name_taken" | "not_pending">>;

  /**
   * Record a pending upload as the next version of the site in its folder and make it live, with the settings asked with it, and mark the upload finished with the versions dropped.
   *
   * All of it is one step: when the version is refused no setting changes, and when the public name is taken no version is added. Each setting that changes writes its own audit entry.
   * The page's title comes with the version and writes none; the typed title changes only when the details name it.
   *
   * @returns `stale_number` when a higher version is already kept; `name_taken` as in `changeAccess`; `not_pending` as in `publishUploadAsSite`
   * @throws {RangeError} `keep` is not a whole number from 1 up
   * @throws {Error} a detail breaks its field rule
   */
  publishUploadAsVersion(
    id: UploadId,
    version: UploadedVersion,
    signed: Signed,
  ): Promise<Published | Refused<"not_found" | "in_trash" | "name_taken" | "stale_number" | "not_pending">>;

  /** Record which of the versions a finished upload dropped still have files in the store, so a later removal goes on from there. */
  setUploadDropped(id: UploadId, dropped: readonly number[]): Promise<void>;

  /**
   * Give a pending upload up, so it takes no file and is never made live. Its manifest is dropped with it.
   *
   * @returns `false` when the upload is not pending
   */
  abandonUpload(id: UploadId): Promise<boolean>;

  /**
   * Remove the record of an upload that is finished or abandoned.
   *
   * @returns `false` when there is no such upload, or it is still pending
   */
  removeUpload(id: UploadId): Promise<boolean>;

  /**
   * One page of the uploads begun before a moment, whatever their state, the oldest first.
   *
   * @param query - the moment, how many uploads from 1 to 100, and the `next` of the page before
   * @throws {RangeError} `limit` is not a whole number from 1 to 100
   */
  listUploads(query: { readonly before: number; readonly limit: number; readonly after?: UploadsCursor }): Promise<UploadsPage>;

  /** Store the record of a new token. */
  addToken(token: TokenRecord, signed: Signed): Promise<{ readonly kind: "done" } | Refused<"id_taken">>;

  /** The record of the token with this id. A removed token has none, so it proves nothing. */
  getToken(id: TokenId): Promise<TokenRecord | undefined>;

  /** The record of every token that was not removed, the newest first, and of tokens made at one moment the one with the greater id. */
  listTokens(): Promise<readonly TokenRecord[]>;

  /**
   * The note of each of these ids' tokens that has one, read in one step however many ids there are: a removed token and one that ran out keep theirs. An id that is no token's, and a token with no note, are left out.
   *
   * @param ids - the tokens to name; each is read once
   */
  getTokenNames(ids: readonly TokenId[]): Promise<ReadonlyMap<TokenId, string>>;

  /**
   * The tokens that work at a moment and the newest that ended, in one read. Every token is in exactly one of the two, or among the ended ones left out.
   *
   * @param now - a token that runs out at this moment has ended
   * @param mostEnded - how many ended tokens are told, from 1 to 100; one row more is read
   * @throws {RangeError} `mostEnded` is not a whole number from 1 to 100
   */
  listTokenStates(now: number, mostEnded: number): Promise<TokenStates>;

  /** Mark a token as removed at `signed.at` by `signed.by`, so it proves nothing from then on. Its row is kept. `not_found` for one that was removed already. */
  revokeToken(id: TokenId, signed: Signed): Promise<{ readonly kind: "done"; readonly token: TokenRecord } | Refused<"not_found">>;

  /**
   * Store a pending login, and make room for it among the logins that wait: the pending ones that have not run out at its `createdAt`. It writes no audit entry: a pending login grants nothing.
   *
   * Its visitor keeps the newest `room.perVisitor` of their waiting logins, this one among them. Once `room.all` logins wait, the oldest one of the visitor with the most gives way. A decided login is never removed here.
   *
   * @returns `taken` when its id or its code is already a login's; no login gave way then
   */
  addComputerLogin(login: PendingLogin, room: LoginRoom): Promise<{ readonly kind: "done" } | Refused<"taken">>;

  /** The login whose secret has this id, whatever its state and whether or not it ran out. */
  getComputerLogin(id: LoginId): Promise<ComputerLogin | undefined>;

  /** The login a person sees under this code, whatever its state and whether or not it ran out. */
  findComputerLogin(code: UserCode): Promise<ComputerLogin | undefined>;

  /** Every login that waits at a moment, pending and not run out, the newest first, and of logins begun at one moment the one with the greater id. */
  listWaitingComputerLogins(now: number): Promise<readonly PendingLogin[]>;

  /**
   * Allow or deny the login under a code, only while it is pending and has not run out. It writes one `login_allowed` or `login_denied` audit entry, which holds the scope and the computer's name and nothing of the secret.
   *
   * A login allowed as a publisher is stored with that scope, so its token and its audit entry are a publisher's.
   *
   * @returns the login after the decision, or `not_pending` for a code of no login and for a login that was decided or ran out
   */
  decideComputerLogin(code: UserCode, decision: LoginDecision): Promise<{ readonly kind: "done"; readonly login: ComputerLogin } | Refused<"not_pending">>;

  /**
   * Turn an allowed login into its token, in one step: the token's record is stored with a `token_added` audit entry signed by the admin who allowed the login, and the login is removed.
   *
   * Of calls made at the same moment one is done, so a login gives one token.
   *
   * @param token - a new token's record, of the login's scope, made at the clock's time
   * @returns `not_allowed` for a login that is pending, denied, gone, run out at the token's `createdAt`, or of another scope than the token
   */
  redeemComputerLogin(id: LoginId, token: TokenRecord): Promise<{ readonly kind: "done" } | Refused<"not_allowed">>;

  /**
   * Remove what ran out by a moment, in one step: every login of a computer that ran out at or before it, whatever its state; every problem of a day before the 30 that are kept;
   * the counts of declared files and store writes of the days before the day before it; and the request counts of days over a year before it. No write of a count drops an old day itself.
   *
   * @returns how many logins were removed
   */
  sweepRunOut(now: number): Promise<number>;

  /**
   * Note a problem on the UTC day of its moment: the day's row of its kind is made, or added to when it was last written in an earlier hour of the clock.
   *
   * @returns whether a row was written: `false` in the same hour, in whichever instance the row was written, and for a limit of a day whose day has a row
   * @throws {Error} a value breaks its rule
   */
  noteProblem(note: ProblemNote): Promise<boolean>;

  /**
   * List the problems from a UTC day on, the kind last seen first.
   *
   * @param since - the first day listed, such as `2026-11-13`
   */
  listProblems(since: string): Promise<readonly Problem[]>;

  /** Where the scheduled sweep's walk stopped: `undefined` before a run kept a place, once a walk ended, and for a kept place no walk can go on from. */
  readSweepPlace(): Promise<SweepPlace | undefined>;

  /** Read what a scheduled run starts from, in one step: the last asking for a newer version, the settings, and where the walk stopped. */
  readSweepStart(): Promise<SweepStart>;

  /** Keep where the scheduled sweep's walk stopped, in place of what was kept; `undefined` forgets it, for a walk that ended. */
  keepSweepPlace(place: SweepPlace | undefined): Promise<void>;

  /** When the install last asked for the newest release and the newest it knows: `undefined` before it ever asked, and for a kept answer that cannot be read. */
  readUpdateCheck(): Promise<UpdateCheck | undefined>;

  /**
   * Keep when the install asked for the newest release and what it knows, in place of what was kept. No audit entry is written.
   *
   * `seen_at` is set here: the moment of this asking for a release whose version differs from the one kept before, and the moment kept before for the same version. The last try to start by itself stays as it was.
   *
   * @returns the whole row as it is kept now
   * @throws {Error} a value breaks its rule
   */
  keepUpdateCheck(check: Pick<UpdateCheck, "checked_at" | "news">): Promise<UpdateCheck>;

  /**
   * Keep what the install knows of the updates it starts by itself, in place of what was kept. Nothing is kept before the install first asked for the newest release. No audit entry is written.
   *
   * @throws {Error} a value breaks its rule
   */
  keepAutoStart(start: AutoStart): Promise<void>;

  /** The last check or repair of the domain, and when the users last changed with no repair after it: `undefined` before any run was kept, and for a kept run that cannot be read. */
  readDomainCheck(): Promise<RememberedCheck | undefined>;

  /**
   * Keep a check or repair of the domain in place of the one kept before, with one `domain_synced` audit entry, in one step: two rows written, however many pieces the run holds.
   *
   * @param check - the run; its `by` and `ran_at` sign the audit entry
   * @param detail - what the audit entry says of the run
   * @param settled - for a repair that left the domain's login standing, the moment it began: a change of the users up to then waits for a repair no more. Left out, a change that waits keeps waiting
   * @throws {Error} a value breaks its rule
   */
  keepDomainCheck(check: DomainCheck, detail: Readonly<Record<string, unknown>>, settled?: number): Promise<void>;

  /** The install's settings, `undefined` before setup stored them. */
  readSettings(): Promise<SettingValues | undefined>;

  /**
   * Read what the dashboard's frame is drawn from, in one step: the settings, the address that starts a rebuild, the kept run of the domain, the last asking for a newer version, and the problems of two days.
   *
   * @param now - the moment of the reading: the problems are those of its UTC day and of the day before, which hold every moment of the last 24 hours
   * @returns each as its own read gives it
   */
  readFrame(now: number): Promise<FrameRecords>;

  /**
   * Store the settings of a new install.
   *
   * @returns `already_set` with the settings already there, which are left as they are
   * @throws {Error} a value breaks its rule
   */
  initSettings(values: SettingValues, signed: Signed): Promise<{ readonly kind: "done" | "already_set"; readonly values: SettingValues }>;

  /**
   * Change some settings. Each given key is replaced; every other key stays as it is, even when another change lands at the same moment. A change that leaves every value as it is writes nothing.
   *
   * Logins that add or drop a user, or that put another user first, are remembered, in the same step, as changed users by an install that keeps a check of its domain. The same users in another order behind the same first one are not.
   *
   * @throws {Error} a value breaks its rule
   */
  changeSettings(
    changes: Partial<SettingValues>,
    signed: Signed,
  ): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up">>;

  /**
   * Let one more email log in. It is one step that reads no list first: of logins added and removed at the same moment, each change lands. It writes one `settings_changed` audit entry, which holds the logins after it.
   * An install that keeps a check of its domain remembers, in the same step, that the users changed: one more row written.
   *
   * @returns `unchanged` for an email that already is a login, which writes nothing
   * @throws {Error} the login is no email in its normal form
   */
  addLogin(login: Login, signed: Signed): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up">>;

  /**
   * Stop one email from logging in, in the same one step, and only while a login that works stays: the signer's own email when it is a login, and any login at all when the signer is none.
   *
   * It writes one `settings_changed` audit entry, which holds the logins after it, and an install that keeps a check of its domain remembers that the users changed.
   *
   * @returns `unchanged` for an email that is no login, and `no_working_login` for the signer's own email or the last login there is; neither writes anything
   * @throws {Error} the login is no email in its normal form
   */
  removeLogin(login: Login, signed: Signed): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up" | "no_working_login">>;

  /** The bytes of the key that signs sessions, `undefined` before one was stored. Only this and `readSettingsAndKey` return them. */
  readSigningKey(): Promise<Uint8Array<ArrayBuffer> | undefined>;

  /**
   * Read the settings and the signing key together, in one step: what a session is checked against.
   *
   * @returns each as its own read gives it, `undefined` before it was stored
   */
  readSettingsAndKey(): Promise<SettingsAndKey>;

  /**
   * Store the signing key when the install has none. Of callers starting at the same moment one stores its key and every other gets that key back.
   *
   * @param fresh - at least 32 newly drawn random bytes, used only when no key is stored
   * @param at - the clock, in milliseconds since the epoch
   * @throws {RangeError} `fresh` is under 32 bytes
   */
  ensureSigningKey(fresh: Uint8Array, at: number): Promise<SigningKey>;

  /**
   * Replace the signing key, which ends every session. It writes one `signed_everyone_out` audit entry, which holds nothing of either key.
   *
   * @param fresh - at least 32 newly drawn random bytes
   * @throws {RangeError} `fresh` is under 32 bytes
   */
  rotateSigningKey(fresh: Uint8Array, signed: Signed): Promise<void>;

  /** The address that starts a rebuild of the install and when it was saved, `undefined` while none is. No other operation returns the address. */
  readUpdateAddress(): Promise<UpdateAddress | undefined>;

  /**
   * Keep the address that starts a rebuild, in place of one kept before. It writes one `update_address_set` audit entry, which holds nothing of the address.
   *
   * @param address - an `https` address the caller has checked
   */
  keepUpdateAddress(address: string, signed: Signed): Promise<void>;

  /** Remove the address that starts a rebuild. It writes one `update_address_removed` audit entry, only when an address was kept. */
  forgetUpdateAddress(signed: Signed): Promise<{ readonly kind: "done" | "unchanged" }>;

  /** Add an entry that goes with no change of a site, a token, or the settings. */
  appendAudit(note: AuditNote, signed: Signed): Promise<void>;

  /** Whether the audit log holds a `login` entry, which is whether anybody has ever logged in. It is one query, whatever the log's length. */
  hasLoggedIn(): Promise<boolean>;

  /**
   * One page of the audit log, the newest entry first, or the oldest first when `dir` is `asc`.
   *
   * @param query - how many entries, from 1 to 1,000, and `after`, the `seq` of the entry the page before ended on: only entries behind that one in the direction asked are answered. A `seq` is a cursor taken from an entry, never a count
   * @returns the page; it reads no row but the page's own
   * @throws {RangeError} `limit` is not a whole number from 1 to 1,000
   */
  listAudit(query: AuditQuery): Promise<readonly AuditEntry[]>;

  /**
   * One page of the entries a narrowing keeps, looked for among no more than `AUDIT_WINDOW` entries of the log from where the reading starts, so a rare match costs a window and not the log.
   * A reading narrowed by a site reads the sites and their earlier ids once more than that.
   *
   * @param query - what `listAudit` takes, and the narrowing: `actions`, `site`, or both
   * @returns the entries found, and where the reading stopped when the window ended before the page was full and the log goes on behind it
   * @throws {RangeError} `limit` is not a whole number from 1 to 1,000
   */
  searchAudit(query: AuditSearch): Promise<AuditFound>;

  /**
   * The page `listAudit` reads, each entry with what it names as it is now: its site, and the note of the token that did it. The one statement that reads the page finds them, each by a key.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to 1,000
   */
  listNamedAudit(query: AuditQuery): Promise<readonly NamedAuditEntry[]>;

  /**
   * The page `searchAudit` reads, each entry with what it names as it is now, found as `listNamedAudit` finds it.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to 1,000
   */
  searchNamedAudit(query: AuditSearch): Promise<NamedAuditFound>;

  /**
   * Count the entries of the audit log a narrowing keeps, reading no further back than the newest `most` entries, so a long log costs no more than `most` rows.
   * A count narrowed by a site reads the sites and their earlier ids once more than that.
   *
   * @returns the count, and whether the whole log was read
   * @throws {RangeError} `most` is not a whole number of at least 1
   */
  countAudit(query: AuditCountQuery): Promise<AuditCount>;

  /**
   * Find where a part of the audit log ends, without handing its entries out: it reads the part's rows and one more, and answers one number.
   *
   * @returns the `seq` of the part's last entry when the log holds an entry behind it, which is the place the next part goes on after; `undefined` when the log ends inside the part or with it
   * @throws {RangeError} `entries` is not a whole number of at least 1
   */
  endOfAuditPart(query: AuditPartQuery): Promise<number | undefined>;

  /**
   * Add requests, and the page views among them, to a day's count of one site and of all sites together. No audit entry is written.
   *
   * @returns both request counts after the addition
   * @throws {RangeError} `day` is not a date such as `2026-11-13`, `requests` is not a whole number of at least 1, `views` is not a whole number from 0 to `requests`, or a count of `rows` is not a whole number from 0
   */
  addRequests(counted: CountedRequests): Promise<RequestCounts>;

  /**
   * What a day has counted for all sites together, 0 where nothing was counted. It is one query.
   *
   * @param day - a UTC date, such as `2026-11-13`
   * @throws {RangeError} `day` is not such a date
   */
  readDayUse(day: string): Promise<DayUse>;

  /**
   * A day's counts so far, 0 where nothing was counted.
   *
   * @param day - a UTC date, such as `2026-11-13`
   * @param site - the site whose own count is read; without it only `all` is read, and `site` is 0
   * @throws {RangeError} `day` is not such a date
   */
  readRequests(day: string, site?: SiteId): Promise<RequestCounts>;

  /**
   * How many times the store was written to or listed on a UTC day so far, a declared file counted when its upload began, and the most the settings allow a day. It is one query.
   *
   * @param day - a UTC date, such as `2026-11-13`
   * @returns `undefined` before setup stored the settings
   * @throws {RangeError} `day` is not such a date
   */
  readStorageWrites(day: string): Promise<{ readonly writes: number; readonly most: number } | undefined>;

  /**
   * Count one write to the store, or one listing of it, on a UTC day, only while the day's count is under the settings' bound and `spare` more.
   * The check and the count are one step: of calls made at the same moment only as many are taken as the day has room for.
   *
   * @param spare - how many beyond the bound the day takes from this caller: a whole number from 0 up
   * @returns whether it was counted; an install whose settings are not stored has no bound
   * @throws {RangeError} `day` is not a date such as `2026-11-13`, or `spare` is not such a number
   */
  takeStorageWrite(day: string, spare: number): Promise<boolean>;

  /**
   * Add to a day's count of the times the store was written to or listed. No audit entry is written.
   *
   * @param writes - how many: a whole number of at least 1
   * @throws {RangeError} `day` is not a date such as `2026-11-13`, or `writes` is not such a number
   */
  addStorageWrites(day: string, writes: number): Promise<void>;

  /**
   * The page views counted for some sites: on one day, and over that day and the six before it.
   *
   * @param sites - the sites to read, at most 100
   * @param day - a UTC date, such as `2026-11-13`
   * @returns the counts of every site asked for, 0 where nothing was counted
   * @throws {RangeError} `day` is not such a date, or more than 100 sites are asked for
   */
  readViews(sites: readonly SiteId[], day: string): Promise<ReadonlyMap<SiteId, SiteViews>>;

  /**
   * The page views counted day by day, for all sites together and for some sites. It is one query, and every row is read by its key.
   *
   * @param sites - the sites to read beside all sites together, at most 50
   * @param day - the last day read, a UTC date such as `2026-11-13`
   * @param count - how many days are read, that day included: a whole number from 1 to 365
   * @returns a count for every day, 0 where nothing was counted
   * @throws {RangeError} `day` is not such a date, `count` is not such a number, or more than 50 sites are asked for
   */
  readDailyViews(sites: readonly SiteId[], day: string, count: number): Promise<DailyViews>;
}
