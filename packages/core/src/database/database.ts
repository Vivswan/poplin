// Everything poplin keeps in its database, as the operations the rest of the code asks for. No SQL and no row leaves this interface.
//
// Every change names who made it and when, and writes its audit entry in the same atomic step: both are kept, or neither.
//
// An implementation keeps these rules itself, whatever it stores records in: a site always holds its live version, no two sites share a folder,
// and no site's public name is any site's id. The cases every implementation runs are in `tests/database/support/database-contract.ts`.

import type { TokenId, TokenRecord } from "../auth/tokens";
import type { PublicName, SiteName } from "../names/names";
import type { AuditAction, AuditEntry } from "../records/audit";
import type { Holder } from "../records/fields";
import type { SiteId } from "../sites/ids";
import type { SettingValues } from "../records/settings";
import type { Site, SiteAccess, SiteFolder } from "../records/site";
import type { SiteSize, Totals } from "../records/sizes";
import type { ManifestFile, Upload, UploadId, UploadPlan } from "../records/upload";

/** Who makes a change and when, in milliseconds since the epoch. */
export interface Signed {
  readonly by: Holder;
  readonly at: number;
}

/**
 * What a new site is made from.
 *
 * `folder` is minted by the caller, so the site's files can be stored before the site is. `embeddable` is `true` when left out.
 *
 * `bytes` is the sum of the sizes of the files of version 1 and `files` their count, both whole numbers from 0 up.
 */
export type NewSite = {
  readonly name: SiteName;
  readonly folder: SiteFolder;
  readonly title: string | null;
  readonly search_engines: boolean;
  readonly embeddable?: boolean;
  readonly expires: "never" | number;
  readonly bytes: number;
  readonly files: number;
} & SiteAccess;

/** The settings of a site that change on their own; a key left out stays as it is. */
export interface SiteDetails {
  readonly title?: string | null;
  readonly search_engines?: boolean;
  readonly embeddable?: boolean;
  readonly expires?: "never" | number;
}

/** Where a visitor's hostname points: a site's id, or a public name. */
export type Address = { readonly id: SiteId } | { readonly public_name: PublicName };

/** Where a page of a listing ended: the change time and the id of its last site. */
interface SitesCursor {
  readonly updated_at: number;
  readonly id: SiteId;
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
}

/** One page of a listing, the site changed last first, and of sites changed at one moment the one with the greater id. `next` is absent on the last page. */
export interface SitesPage {
  readonly sites: readonly Site[];
  readonly next?: SitesCursor;
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
}

/** The signing key and whether this call stored it. `kept` is a key that was already there, which is the one to use. */
export interface SigningKey {
  readonly kind: "created" | "kept";
  readonly key: Uint8Array<ArrayBuffer>;
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

/** Requests to add to a day's counts. */
export interface CountedRequests {
  /** The UTC date, such as `2026-11-13`. */
  readonly day: string;

  /** The site that answered them. */
  readonly site: SiteId;

  /** How many: a whole number of at least 1. */
  readonly requests: number;
}

/** The one doorway to stored sites, tokens, settings, the signing key, the audit log, and the day's request counts. */
export interface Database {
  /**
   * Make a site under a fresh id, with version 1 as its only version and its live one: published at `signed.at` by `signed.by`, of the draft's `bytes` and `files`.
   *
   * @returns the site, or `name_taken` when it is to be public and another site holds the public name or has it as its id, whatever its folder
   * @throws {Error} the draft breaks a field rule, or its folder is a site's, in the trash or not; nothing is stored
   */
  createSite(draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken">>;

  /** The site with this id, in the trash or not. */
  getSite(id: SiteId): Promise<Site | undefined>;

  /** The site holding this public name, in the trash or not. */
  getSiteByPublicName(name: PublicName): Promise<Site | undefined>;

  /**
   * The site an address serves at `now`.
   *
   * @returns `undefined` for an address of no site, of a site in the trash, or of a site past its expiry
   */
  findServed(address: Address, now: number): Promise<Site | undefined>;

  /**
   * One page of the sites, or of the trash.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to 100
   */
  listSites(query: SitesQuery): Promise<SitesPage>;

  /** Set who may open a site. Going public claims the public name; leaving public frees it. `name_taken` as in `createSite`. */
  changeAccess(id: SiteId, access: SiteAccess, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">>;

  /**
   * Set a site's title, search-engines flag, embeddable flag, or expiry.
   *
   * @throws {Error} a value breaks its field rule
   */
  changeDetails(id: SiteId, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash">>;

  /** Give a site a new id. The old id names no site from then on; the public name, the folder, and everything else stay with the site. */
  giveNewId(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">>;

  /** Move a site into the trash. It keeps its public name. */
  trashSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">>;

  /** Take a site out of the trash. An expiry that is not after `signed.at` becomes `"never"` in the same step, so the site is served again and no sweep trashes it for that expiry. */
  restoreSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "not_in_trash">>;

  /** Remove a site for good, from the trash or not. Its public name is free again; `site` is the site as it was, whose folder the caller empties. */
  deleteSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found">>;

  /** Set aside the next version number of a site. No two calls get the same number; a number never used is simply skipped. It writes no audit entry: nothing a reader of the site sees has changed. */
  reserveVersion(id: SiteId): Promise<Reserved | Refused<"not_found" | "in_trash">>;

  /**
   * Record a publish under a reserved number and make it live.
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

  /** What the kept versions of one site hold together, in the trash or not; `undefined` for no site. */
  getSiteSize(id: SiteId): Promise<SiteSize | undefined>;

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
   * Store a site from a backup exactly as it was exported: its id, folder, access, versions, owner, times, and place in or out of the trash.
   *
   * The site and all its versions are stored together or not at all, with one `imported` audit entry. Version numbers go on from above its highest kept version.
   *
   * @returns the first of these that holds: `id_taken` when a site has the id as its id or its public name, `folder_taken` when a site has the folder, `name_taken` as in `createSite` or when the public name is the site's own id
   * @throws {Error} the value is no site
   */
  importSite(site: Site, signed: Signed): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken">>;

  /**
   * Store a pending upload's site from a backup as `importSite` does, and mark the upload finished, in one step.
   *
   * @param site - the site, whose folder is the upload's
   * @returns `not_pending` when the upload is finished, abandoned, gone, or of another folder; every other refusal as in `importSite`, which leaves the upload pending
   * @throws {Error} the value is no site
   */
  importUploadAsSite(id: UploadId, site: Site, signed: Signed): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken" | "not_pending">>;

  /** The site whose files sit under this folder, in the trash or not. */
  getSiteByFolder(folder: SiteFolder): Promise<Site | undefined>;

  /**
   * Record a staged publish as pending, only while it fits the room it is given. It writes no audit entry: nothing a reader of any site sees has changed.
   *
   * @returns the first bound the upload does not fit, in the order `own`, `folder`, `total`, `sites`; of uploads recorded at the same moment only those that fit together are kept
   * @throws {Error} a value breaks its field rule, the manifest is empty, or the id or the folder and number are already an upload's
   */
  addUpload(upload: NewUpload, room: UploadRoom): Promise<{ readonly kind: "done" } | Refused<"own_full" | "folder_full" | "total_full" | "sites_full">>;

  /** The upload with this id and its manifest, which is empty once the upload is finished or abandoned. */
  getUpload(id: UploadId): Promise<{ readonly upload: Upload; readonly manifest: readonly ManifestFile[] } | undefined>;

  /** The upload with this id and the one file of its manifest at `path`, `undefined` when the manifest names none there. The manifest itself is not read out. */
  getUploadFile(id: UploadId, path: string): Promise<{ readonly upload: Upload; readonly file: ManifestFile | undefined } | undefined>;

  /**
   * Make a pending upload's site, at version 1 under a fresh id, and mark the upload finished, in one step. The site belongs to whoever began the upload, whoever finishes it.
   *
   * @param draft - the site, whose folder is the upload's
   * @returns `not_pending` when the upload is finished, abandoned, gone, or of another folder; `name_taken` as in `createSite`
   * @throws {Error} the draft breaks a field rule, or its folder is already a site's
   */
  publishUploadAsSite(id: UploadId, draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken" | "not_pending">>;

  /**
   * Record a pending upload as the next version of the site in its folder and make it live, with the settings asked with it, and mark the upload finished with the versions dropped.
   *
   * All of it is one step: when the version is refused no setting changes, and when the public name is taken no version is added. Each setting that changes writes its own audit entry.
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

  /** The record of the token with this id. */
  getToken(id: TokenId): Promise<TokenRecord | undefined>;

  /** Every token record, the newest first, and of tokens made at one moment the one with the greater id. */
  listTokens(): Promise<readonly TokenRecord[]>;

  /** Remove a token's record, so the token proves nothing from then on. */
  revokeToken(id: TokenId, signed: Signed): Promise<{ readonly kind: "done"; readonly token: TokenRecord } | Refused<"not_found">>;

  /** The install's settings, `undefined` before setup stored them. */
  readSettings(): Promise<SettingValues | undefined>;

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
   * @throws {Error} a value breaks its rule
   */
  changeSettings(
    changes: Partial<SettingValues>,
    signed: Signed,
  ): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up">>;

  /** The bytes of the key that signs sessions, `undefined` before one was stored. No other operation returns them. */
  readSigningKey(): Promise<Uint8Array<ArrayBuffer> | undefined>;

  /**
   * Store the signing key when the install has none. Of callers starting at the same moment one stores its key and every other gets that key back.
   *
   * @param fresh - at least 32 newly drawn random bytes, used only when no key is stored
   * @param at - the clock, in milliseconds since the epoch
   * @throws {RangeError} `fresh` is under 32 bytes
   */
  ensureSigningKey(fresh: Uint8Array, at: number): Promise<SigningKey>;

  /**
   * Replace the signing key, which ends every session. It writes one `signed-everyone-out` audit entry, which holds nothing of either key.
   *
   * @param fresh - at least 32 newly drawn random bytes
   * @throws {RangeError} `fresh` is under 32 bytes
   */
  rotateSigningKey(fresh: Uint8Array, signed: Signed): Promise<void>;

  /** Add an entry that goes with no change of a site, a token, or the settings. */
  appendAudit(note: AuditNote, signed: Signed): Promise<void>;

  /**
   * The newest audit entries, the newest first.
   *
   * @param query - how many entries, from 1 to 100, and `before`, the `seq` of the entry the page before ended on: only entries written before that one are answered. A `seq` is a cursor taken from an entry, never a count
   * @throws {RangeError} `limit` is not a whole number from 1 to 100
   */
  listAudit(query: { readonly limit: number; readonly before?: number }): Promise<readonly AuditEntry[]>;

  /**
   * Add requests to a day's count of one site and of all sites together, and drop the counts of every earlier day. No audit entry is written.
   *
   * @returns both counts after the addition
   * @throws {RangeError} `day` is not a date such as `2026-11-13`, or `requests` is not a whole number of at least 1
   */
  addRequests(counted: CountedRequests): Promise<RequestCounts>;

  /**
   * A day's counts so far, 0 where nothing was counted.
   *
   * @param day - a UTC date, such as `2026-11-13`
   * @param site - the site whose own count is read; without it only `all` is read, and `site` is 0
   * @throws {RangeError} `day` is not such a date
   */
  readRequests(day: string, site?: SiteId): Promise<RequestCounts>;
}
