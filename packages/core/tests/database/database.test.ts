// The `Database` interface over plain maps, with no SQL anywhere, run through the contract every database keeps: so the contract asks for nothing only a SQL engine gives.
// The implementation exists for this test alone. It keeps nothing past its own lifetime, and an operation runs to its end without yielding, which is all the atomicity it has.

import { isDeepStrictEqual } from "node:util";

import * as v from "valibot";

import type { TokenId, TokenRecord } from "../../src/auth/tokens";
import type {
  Address,
  AuditNote,
  CountedRequests,
  Database,
  Done,
  ExportPage,
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
} from "../../src/database/database";
import type { PublicName, SiteName } from "../../src/names/names";
import type { AuditAction, AuditEntry } from "../../src/records/audit";
import { SETTING_CHANGES, SETTING_VALUES, type SettingValues } from "../../src/records/settings";
import { NEW_SITE, SITE_DETAILS, type Site, type SiteAccess, siteToRow } from "../../src/records/site";
import type { SiteSize, Totals } from "../../src/records/sizes";
import { type ManifestFile, manifestFromText, type Upload, type UploadId, uploadFromRow } from "../../src/records/upload";
import { mintSiteId, type SiteId } from "../../src/sites/ids";
import { describeDatabase } from "./support/database-contract";

/** How many ids are tried for one site before giving up. */
const MINT_ATTEMPTS = 5;

/** The most entries one page of a listing holds. */
const MAX_PAGE = 100;

/** The fewest bytes a signing key holds. */
const KEY_BYTES = 32;

/** The form of a day: a date such as `2026-11-13`, which sorts as text in the order of time. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The key a day's count of all sites together is kept under; no site id is empty. */
const ALL_SITES = "";

/** What a site holds whatever its access and wherever it sits. */
type Fields = Omit<Site, "access" | "state">;

/** Whether a site is served or sits in the trash. */
type Place = { readonly state: "live" } | { readonly state: "trash"; readonly trashed_at: number };

/** What places a site in a listing, which is also what a page's cursor holds. */
type Listed = Pick<Fields, "updated_at" | "id">;

/** A site as the map keeps it, with the next version number to hand out, which no read of a site shows. */
interface Kept {
  readonly fields: Fields;
  readonly access: SiteAccess;
  readonly place: Place;
  readonly nextVersion: number;
}

function requirePage(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE) throw new RangeError(`a page holds 1 to ${MAX_PAGE} entries, not ${limit}`);
}

function requireCount(what: string, count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`${what} is a whole number from 0 up, not ${count}`);
}

function requireDay(day: string): void {
  if (!DAY_PATTERN.test(day)) throw new RangeError(`a day is a date such as 2026-11-13, not ${JSON.stringify(day)}`);
}

function requireKey(key: Uint8Array): void {
  if (key.length < KEY_BYTES) throw new RangeError(`a signing key holds at least ${KEY_BYTES} bytes, not ${key.length}`);
}

/** The access with its own keys alone, whatever else the given value carries. */
function accessOf(access: SiteAccess): SiteAccess {
  if (access.access === "public") return { access: "public", public_name: access.public_name };

  return { access: access.access };
}

function publicNameOf(access: SiteAccess): PublicName | null {
  return access.access === "public" ? access.public_name : null;
}

function siteOf(kept: Kept): Site {
  return { ...kept.fields, ...kept.access, ...kept.place };
}

function keptOf(site: Site, nextVersion: number): Kept {
  const { id, name, folder, title, search_engines, embeddable, expires, live_version, versions, owner, created_at, updated_at } = site;
  const fields = { id, name, folder, title, search_engines, embeddable, expires, live_version, versions, owner, created_at, updated_at };
  const place: Place = site.state === "trash" ? { state: "trash", trashed_at: site.trashed_at } : { state: "live" };

  return { fields, access: accessOf(site), place, nextVersion };
}

function changedAt(kept: Kept, at: number, change: Partial<Fields> = {}): Kept {
  return { ...kept, fields: { ...kept.fields, ...change, updated_at: at } };
}

/** Why a site that is live could not be changed: there is none, or it sits in the trash. `undefined` for a live site. */
function unreachable(kept: Kept | undefined): Refused<"not_found" | "in_trash"> | undefined {
  if (kept === undefined) return { kind: "not_found" };

  if (kept.place.state === "trash") return { kind: "in_trash" };

  return undefined;
}

/** Whether the first site comes before the second in a listing: the one changed last first, and of two changed at one moment the one with the greater id. */
function listedBefore(left: Listed, right: Listed): boolean {
  if (left.updated_at !== right.updated_at) return left.updated_at > right.updated_at;

  return left.id > right.id;
}

class MemoryDatabase implements Database {
  readonly #sites = new Map<SiteId, Kept>();

  readonly #tokens = new Map<TokenId, TokenRecord>();

  readonly #audit: AuditEntry[] = [];

  readonly #requests = new Map<string, Map<string, number>>();

  readonly #uploads = new Map<UploadId, { readonly upload: Upload; readonly manifest: readonly ManifestFile[] }>();

  readonly #mintId: () => SiteId;

  #settings: SettingValues | undefined;

  #signingKey: Uint8Array<ArrayBuffer> | undefined;

  constructor(mintId: () => SiteId = mintSiteId) {
    this.#mintId = mintId;
  }

  async createSite(draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken">> {
    const site = v.parse(NEW_SITE, draft);
    const access = accessOf(site);
    const publicName = publicNameOf(access);
    if (publicName !== null && this.#holds(publicName)) return { kind: "name_taken" };

    if (this.#holdsFolder(site.folder)) throw new Error("the folder is already a site's");

    const first = { number: 1, published_at: signed.at, published_by: signed.by, bytes: site.bytes, files: site.files };
    const fields: Fields = {
      id: this.#freshId(publicName),
      name: site.name,
      folder: site.folder,
      title: site.title,
      search_engines: site.search_engines,
      embeddable: site.embeddable,
      expires: site.expires,
      live_version: 1,
      versions: [first],
      owner: signed.by,
      created_at: signed.at,
      updated_at: signed.at,
    };

    return this.#changed({ fields, access, place: { state: "live" }, nextVersion: 2 }, signed, "create", { access: access.access, public_name: publicName });
  }

  async getSite(id: SiteId): Promise<Site | undefined> {
    const kept = this.#sites.get(id);

    return kept === undefined ? undefined : siteOf(kept);
  }

  async getSiteByPublicName(name: PublicName): Promise<Site | undefined> {
    const kept = this.#byPublicName(name);

    return kept === undefined ? undefined : siteOf(kept);
  }

  async findServed(address: Address, now: number): Promise<Site | undefined> {
    const kept = "id" in address ? this.#sites.get(address.id) : this.#byPublicName(address.public_name);
    if (kept === undefined || kept.place.state === "trash") return undefined;

    if (kept.fields.expires !== "never" && kept.fields.expires <= now) return undefined;

    return siteOf(kept);
  }

  async listSites(query: SitesQuery): Promise<SitesPage> {
    requirePage(query.limit);

    const { after, owner } = query;
    const listed = [...this.#sites.values()]
      .filter((kept) => (kept.place.state === "trash") === query.trash)
      .filter((kept) => owner === undefined || kept.fields.owner === owner)
      .filter((kept) => after === undefined || listedBefore(after, kept.fields))
      .sort((left, right) => (listedBefore(left.fields, right.fields) ? -1 : 1));
    const sites = listed.slice(0, query.limit).map(siteOf);
    const last = sites.at(-1);
    if (last === undefined || listed.length <= query.limit) return { sites };

    return { sites, next: { updated_at: last.updated_at, id: last.id } };
  }

  async changeAccess(id: SiteId, access: SiteAccess, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "name_taken">> {
    const kept = this.#sites.get(id);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    const publicName = publicNameOf(access);
    if (kept.access.access === access.access && publicNameOf(kept.access) === publicName) return { kind: "unchanged", site: siteOf(kept) };

    if (publicName !== null && this.#holds(publicName)) return { kind: "name_taken" };

    return this.#changed({ ...changedAt(kept, signed.at), access: accessOf(access) }, signed, "access", { access: access.access, public_name: publicName });
  }

  async changeDetails(id: SiteId, details: SiteDetails, signed: Signed): Promise<Done | Unchanged | Refused<"not_found" | "in_trash">> {
    const given = v.parse(SITE_DETAILS, details);
    const kept = this.#sites.get(id);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    const stated = Object.entries(given).filter(([, value]) => value !== undefined);
    const differs = stated.some(([key, value]) => kept.fields[key as keyof SiteDetails] !== value);
    if (!differs) return { kind: "unchanged", site: siteOf(kept) };

    return this.#changed(changedAt(kept, signed.at, Object.fromEntries(stated)), signed, "details", given);
  }

  async giveNewId(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    const kept = this.#sites.get(id);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    const next = this.#freshId(null);
    this.#sites.delete(id);

    return this.#changed(changedAt(kept, signed.at, { id: next }), signed, "new_id", { from: id });
  }

  async trashSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "in_trash">> {
    const kept = this.#sites.get(id);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    return this.#changed({ ...changedAt(kept, signed.at), place: { state: "trash", trashed_at: signed.at } }, signed, "trash", {});
  }

  async restoreSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found" | "not_in_trash">> {
    const kept = this.#sites.get(id);
    if (kept === undefined) return { kind: "not_found" };

    if (kept.place.state === "live") return { kind: "not_in_trash" };

    return this.#changed({ ...changedAt(kept, signed.at), place: { state: "live" } }, signed, "restore", {});
  }

  async deleteSite(id: SiteId, signed: Signed): Promise<Done | Refused<"not_found">> {
    const kept = this.#sites.get(id);
    if (kept === undefined) return { kind: "not_found" };

    this.#sites.delete(id);
    this.#log(signed, "delete", kept.fields, {});

    return { kind: "done", site: siteOf(kept) };
  }

  async reserveVersion(id: SiteId): Promise<Reserved | Refused<"not_found" | "in_trash">> {
    const kept = this.#sites.get(id);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    this.#sites.set(id, { ...kept, nextVersion: kept.nextVersion + 1 });

    return { kind: "reserved", number: kept.nextVersion };
  }

  async addVersion(id: SiteId, version: NewVersion, signed: Signed): Promise<Published | Refused<"not_found" | "in_trash" | "stale_number">> {
    if (!Number.isSafeInteger(version.keep) || version.keep < 1) throw new RangeError(`a site keeps at least 1 version, not ${version.keep}`);

    requireCount("the size of a version in bytes", version.bytes);
    requireCount("the number of files of a version", version.files);

    const kept = this.#sites.get(id);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    const highest = Math.max(...kept.fields.versions.map((entry) => entry.number));
    if (version.number >= kept.nextVersion || version.number <= highest) return { kind: "stale_number" };

    const added = { number: version.number, published_at: signed.at, published_by: signed.by, bytes: version.bytes, files: version.files };
    const all = [...kept.fields.versions, added];
    const cut = Math.max(0, all.length - version.keep);
    const fields = { live_version: version.number, versions: all.slice(cut) };
    const published = this.#changed(changedAt(kept, signed.at, fields), signed, "publish", { version: version.number });

    return { ...published, dropped: all.slice(0, cut).map((entry) => entry.number) };
  }

  async setLiveVersion(
    id: SiteId,
    target: number | "previous",
    signed: Signed,
  ): Promise<Done | Unchanged | Refused<"not_found" | "in_trash" | "no_such_version">> {
    const kept = this.#sites.get(id);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    const { live_version: live, versions } = kept.fields;
    if (target === live) return { kind: "unchanged", site: siteOf(kept) };

    const wanted = target === "previous" ? versions.filter((entry) => entry.number < live).at(-1) : versions.find((entry) => entry.number === target);
    if (wanted === undefined) return { kind: "no_such_version" };

    return this.#changed(changedAt(kept, signed.at, { live_version: wanted.number }), signed, "live_version", { version: wanted.number });
  }

  async getSiteSize(id: SiteId): Promise<SiteSize | undefined> {
    const kept = this.#sites.get(id);
    if (kept === undefined) return undefined;

    return {
      bytes: kept.fields.versions.reduce((sum, entry) => sum + entry.bytes, 0),
      files: kept.fields.versions.reduce((sum, entry) => sum + entry.files, 0),
    };
  }

  async readTotals(): Promise<Totals> {
    const sites = [...this.#sites.values()];
    const versions = sites.flatMap((kept) => kept.fields.versions);

    return {
      sites: sites.length,
      trashed_sites: sites.filter((kept) => kept.place.state === "trash").length,
      bytes: versions.reduce((sum, entry) => sum + entry.bytes, 0),
      files: versions.reduce((sum, entry) => sum + entry.files, 0),
    };
  }

  async exportSites(query: { readonly limit: number; readonly after?: SiteId }): Promise<ExportPage> {
    requirePage(query.limit);

    const { after } = query;
    const ids = [...this.#sites.keys()].filter((id) => after === undefined || id > after).sort();
    const sites = ids.slice(0, query.limit).flatMap((id) => {
      const kept = this.#sites.get(id);

      return kept === undefined ? [] : [siteOf(kept)];
    });
    const last = sites.at(-1);
    if (last === undefined || ids.length <= query.limit) return { sites };

    return { sites, next: last.id };
  }

  async importSite(site: Site, signed: Signed): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken">> {
    return this.#imported(site, signed);
  }

  async addToken(token: TokenRecord, signed: Signed): Promise<{ readonly kind: "done" } | Refused<"id_taken">> {
    if (this.#tokens.has(token.id)) return { kind: "id_taken" };

    this.#tokens.set(token.id, { ...token });
    this.#log(signed, "token_added", null, { token: token.id, scope: token.scope, note: token.note });

    return { kind: "done" };
  }

  async getToken(id: TokenId): Promise<TokenRecord | undefined> {
    return this.#tokens.get(id);
  }

  async listTokens(): Promise<readonly TokenRecord[]> {
    return [...this.#tokens.values()].sort((left, right) => {
      if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;

      return left.id > right.id ? -1 : 1;
    });
  }

  async revokeToken(id: TokenId, signed: Signed): Promise<{ readonly kind: "done"; readonly token: TokenRecord } | Refused<"not_found">> {
    const token = this.#tokens.get(id);
    if (token === undefined) return { kind: "not_found" };

    this.#tokens.delete(id);
    this.#log(signed, "token_revoked", null, { token: token.id, scope: token.scope, note: token.note });

    return { kind: "done", token };
  }

  async readSettings(): Promise<SettingValues | undefined> {
    return this.#settings;
  }

  async initSettings(values: SettingValues, signed: Signed): Promise<{ readonly kind: "done" | "already_set"; readonly values: SettingValues }> {
    const checked = v.parse(SETTING_VALUES, values);
    if (this.#settings !== undefined) return { kind: "already_set", values: this.#settings };

    this.#settings = checked;
    this.#log(signed, "settings_set", null, {});

    return { kind: "done", values: checked };
  }

  async changeSettings(
    changes: Partial<SettingValues>,
    signed: Signed,
  ): Promise<{ readonly kind: "done" | "unchanged"; readonly values: SettingValues } | Refused<"not_set_up">> {
    const checked = v.parse(SETTING_CHANGES, changes);
    if (this.#settings === undefined) return { kind: "not_set_up" };

    const stated = Object.entries(checked).filter(([, value]) => value !== undefined);
    const values: SettingValues = { ...this.#settings, ...Object.fromEntries(stated) };
    if (isDeepStrictEqual(values, this.#settings)) return { kind: "unchanged", values };

    this.#settings = values;
    this.#log(signed, "settings_changed", null, checked);

    return { kind: "done", values };
  }

  async readSigningKey(): Promise<Uint8Array<ArrayBuffer> | undefined> {
    return this.#signingKey === undefined ? undefined : Uint8Array.from(this.#signingKey);
  }

  // The clock is given for the record of when the key was stored, which no read of the interface shows; nothing here keeps it.
  async ensureSigningKey(fresh: Uint8Array): Promise<SigningKey> {
    requireKey(fresh);

    if (this.#signingKey !== undefined) return { kind: "kept", key: Uint8Array.from(this.#signingKey) };

    this.#signingKey = Uint8Array.from(fresh);

    return { kind: "created", key: Uint8Array.from(fresh) };
  }

  async rotateSigningKey(fresh: Uint8Array, signed: Signed): Promise<void> {
    requireKey(fresh);
    this.#signingKey = Uint8Array.from(fresh);
    this.#log(signed, "signed-everyone-out", null, {});
  }

  async appendAudit(note: AuditNote, signed: Signed): Promise<void> {
    this.#log(signed, note.action, note.site ?? null, note.detail);
  }

  async listAudit(query: { readonly limit: number; readonly before?: number }): Promise<readonly AuditEntry[]> {
    requirePage(query.limit);

    const { before } = query;
    const older = this.#audit.filter((entry) => before === undefined || entry.seq < before);

    return older.reverse().slice(0, query.limit);
  }

  async addRequests(counted: CountedRequests): Promise<RequestCounts> {
    requireDay(counted.day);
    if (!Number.isSafeInteger(counted.requests) || counted.requests < 1) throw new RangeError(`requests are counted in whole numbers from 1, not ${counted.requests}`);

    for (const day of [...this.#requests.keys()]) {
      if (day < counted.day) this.#requests.delete(day);
    }

    const counts = this.#requests.get(counted.day) ?? new Map<string, number>();
    const site = (counts.get(counted.site) ?? 0) + counted.requests;
    const all = (counts.get(ALL_SITES) ?? 0) + counted.requests;
    this.#requests.set(counted.day, counts.set(counted.site, site).set(ALL_SITES, all));

    return { site, all };
  }

  async readRequests(day: string, site?: SiteId): Promise<RequestCounts> {
    requireDay(day);
    const counts = this.#requests.get(day);
    const own = site === undefined ? 0 : (counts?.get(site) ?? 0);

    return { site: own, all: counts?.get(ALL_SITES) ?? 0 };
  }

  async getSiteByFolder(folder: Site["folder"]): Promise<Site | undefined> {
    const kept = this.#byFolder(folder);

    return kept === undefined ? undefined : siteOf(kept);
  }

  async addUpload(upload: NewUpload, room: UploadRoom): Promise<{ readonly kind: "done" } | Refused<"own_full" | "folder_full" | "total_full" | "sites_full">> {
    // The checks of a stored upload are the ones that read its row; they are used here for their verdict.
    const manifest = manifestFromText(JSON.stringify(upload.manifest));
    const bytes = manifest.reduce((sum, file) => sum + file.size, 0);
    const checked = uploadFromRow({ ...upload, state: "pending", plan: JSON.stringify(upload.plan), bytes, files: manifest.length, dropped: "[]" });
    const all = [...this.#uploads.values()].map((kept) => kept.upload);
    const taken = all.some((kept) => kept.folder === checked.folder && kept.number === checked.number);
    if (taken || this.#uploads.has(checked.id)) throw new Error("the id, or the folder and number, are already an upload's");

    const pending = all.filter((kept) => kept.state === "pending");
    const sum = (sized: readonly { readonly bytes: number }[]): number => sized.reduce((total, kept) => total + kept.bytes, 0);
    const sites = [...this.#sites.values()];
    const totals = { sites: sites.length, bytes: sum(sites.flatMap((kept) => kept.fields.versions)) };
    if (pending.filter((kept) => kept.owner === checked.owner).length >= room.own) return { kind: "own_full" };

    const versions = this.#byFolder(checked.folder)?.fields.versions ?? [];
    const staying = sum(versions.slice(Math.max(versions.length - room.staying, 0)));
    if (sum(pending.filter((kept) => kept.folder === checked.folder)) + staying + bytes > room.folderBytes) return { kind: "folder_full" };

    if (sum(pending) + totals.bytes + bytes > room.totalBytes) return { kind: "total_full" };

    if (room.sites !== null && pending.filter((kept) => kept.number === 1).length + totals.sites >= room.sites) return { kind: "sites_full" };

    this.#uploads.set(checked.id, { upload: checked, manifest });

    return { kind: "done" };
  }

  async getUpload(id: UploadId): Promise<{ readonly upload: Upload; readonly manifest: readonly ManifestFile[] } | undefined> {
    return this.#uploads.get(id);
  }

  async getUploadFile(id: UploadId, path: string): Promise<{ readonly upload: Upload; readonly file: ManifestFile | undefined } | undefined> {
    const kept = this.#uploads.get(id);
    if (kept === undefined) return undefined;

    return { upload: kept.upload, file: kept.manifest.find((file) => file.path === path) };
  }

  async publishUploadAsSite(id: UploadId, draft: NewSite, signed: Signed): Promise<Done | Refused<"name_taken" | "not_pending">> {
    const site = v.parse(NEW_SITE, draft);
    const upload = this.#uploads.get(id)?.upload;
    if (upload?.state !== "pending" || upload.folder !== site.folder || upload.number !== 1) return { kind: "not_pending" };

    const publicName = publicNameOf(accessOf(site));
    if (publicName !== null && this.#holds(publicName)) return { kind: "name_taken" };

    // The upload is finished before the first wait, so a finish started at the same moment finds it so.
    this.#finish(upload, []);
    const made = await this.createSite(draft, signed);
    const kept = made.kind === "done" ? this.#sites.get(made.site.id) : undefined;
    if (kept === undefined) return made;

    // The site is its upload's owner's, whoever finished it; the audit entry stays the finisher's.
    const fields = { ...kept.fields, owner: upload.owner, versions: kept.fields.versions.map((entry) => ({ ...entry, published_by: upload.owner })) };
    this.#sites.set(fields.id, { ...kept, fields });

    return { kind: "done", site: siteOf({ ...kept, fields }) };
  }

  async importUploadAsSite(id: UploadId, site: Site, signed: Signed): Promise<Done | Refused<"id_taken" | "folder_taken" | "name_taken" | "not_pending">> {
    siteToRow(site);
    const upload = this.#uploads.get(id)?.upload;
    if (upload?.state !== "pending" || upload.folder !== site.folder || upload.number !== 1) return { kind: "not_pending" };

    // The site is stored and the upload finished before the first wait, so a finish started at the same moment finds it so.
    const imported = this.#imported(site, signed);
    if (imported.kind === "done") this.#finish(upload, []);

    return imported;
  }

  async publishUploadAsVersion(
    id: UploadId,
    version: UploadedVersion,
    signed: Signed,
  ): Promise<Published | Refused<"not_found" | "in_trash" | "name_taken" | "stale_number" | "not_pending">> {
    if (!Number.isSafeInteger(version.keep) || version.keep < 1) throw new RangeError(`a site keeps at least 1 version, not ${version.keep}`);

    const details = v.parse(SITE_DETAILS, version.details);
    const upload = this.#uploads.get(id)?.upload;
    if (upload?.state !== "pending") return { kind: "not_pending" };

    const kept = this.#byFolder(upload.folder);
    const refusal = unreachable(kept);
    if (kept === undefined || refusal !== undefined) return refusal ?? { kind: "not_found" };

    const publicName = version.access === undefined ? null : publicNameOf(version.access);
    const held = publicName !== null && publicNameOf(kept.access) !== publicName && this.#holds(publicName);
    const highest = Math.max(...kept.fields.versions.map((entry) => entry.number));
    if (held) return { kind: "name_taken" };

    if (upload.number >= kept.nextVersion || upload.number <= highest) return { kind: "stale_number" };

    // The upload is finished before the first wait, so a finish started at the same moment finds it so.
    this.#finish(upload, []);

    // The three changes are started without a wait between them: each runs to its end as it is called, so nothing else comes in between.
    const { id: site } = kept.fields;
    const set = version.access === undefined ? undefined : this.changeAccess(site, version.access, signed);
    const detailed = this.changeDetails(site, details, signed);
    const published = await this.addVersion(site, { number: upload.number, keep: version.keep, bytes: upload.bytes, files: upload.files }, signed);
    await Promise.all([set, detailed]);
    if (published.kind !== "done") throw new Error(`a version that was checked was refused: ${published.kind}`);

    this.#finish(upload, published.dropped);

    return published;
  }

  async setUploadDropped(id: UploadId, dropped: readonly number[]): Promise<void> {
    const kept = this.#uploads.get(id);
    if (kept?.upload.state === "finished") this.#uploads.set(id, { ...kept, upload: { ...kept.upload, dropped: [...dropped] } });
  }

  async abandonUpload(id: UploadId): Promise<boolean> {
    const kept = this.#uploads.get(id);
    if (kept?.upload.state !== "pending") return false;

    this.#uploads.set(id, { manifest: [], upload: { ...kept.upload, state: "abandoned" } });

    return true;
  }

  async removeUpload(id: UploadId): Promise<boolean> {
    const state = this.#uploads.get(id)?.upload.state;
    if (state === undefined || state === "pending") return false;

    return this.#uploads.delete(id);
  }

  async listUploads(query: { readonly before: number; readonly limit: number; readonly after?: { readonly created_at: number; readonly id: UploadId } }): Promise<UploadsPage> {
    requirePage(query.limit);

    const { after } = query;
    const follows = (upload: Upload): boolean => after === undefined || upload.created_at > after.created_at || (upload.created_at === after.created_at && upload.id > after.id);
    const listed = [...this.#uploads.values()]
      .map((kept) => kept.upload)
      .filter((upload) => upload.created_at < query.before && follows(upload))
      .sort((left, right) => left.created_at - right.created_at || (left.id < right.id ? -1 : 1));
    const uploads = listed.slice(0, query.limit);
    const last = uploads.at(-1);
    if (last === undefined || listed.length <= query.limit) return { uploads };

    return { uploads, next: { created_at: last.created_at, id: last.id } };
  }

  /** Whether a site has this text as its id or as its public name: the two are one set of addresses. */
  #holds(address: string): boolean {
    return this.#sites.has(address as SiteId) || this.#byPublicName(address) !== undefined;
  }

  #holdsFolder(folder: string): boolean {
    return [...this.#sites.values()].some((kept) => kept.fields.folder === folder);
  }

  #byFolder(folder: string): Kept | undefined {
    return [...this.#sites.values()].find((kept) => kept.fields.folder === folder);
  }

  /** Keep a site from a backup under its own id, unless a site holds its id, its folder, or its public name. */
  #imported(site: Site, signed: Signed): Done | Refused<"id_taken" | "folder_taken" | "name_taken"> {
    // The one check of a whole site that core has is the one that turns it into a row; it is used here for its verdict and for the versions in ascending order.
    const { versions } = siteToRow(site);
    if (this.#holds(site.id)) return { kind: "id_taken" };

    if (this.#holdsFolder(site.folder)) return { kind: "folder_taken" };

    const publicName = publicNameOf(site);
    if (publicName !== null && (publicName === (site.id as string) || this.#holds(publicName))) return { kind: "name_taken" };

    const highest = Math.max(...versions.map((entry) => entry.number));

    return this.#changed(keptOf({ ...site, versions }, highest + 1), signed, "imported", { versions: versions.length });
  }

  /** Keep an upload as finished, with the versions its publish dropped. */
  #finish(upload: Upload, dropped: readonly number[]): void {
    const kept = this.#uploads.get(upload.id);
    if (kept !== undefined) this.#uploads.set(upload.id, { manifest: [], upload: { ...upload, state: "finished", dropped: [...dropped] } });
  }

  #byPublicName(name: string): Kept | undefined {
    return [...this.#sites.values()].find((kept) => publicNameOf(kept.access) === name);
  }

  /** An id no site has as its id or its public name, and that is not `besides`, the public name the site itself is about to hold. */
  #freshId(besides: string | null): SiteId {
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const id = this.#mintId();
      if (id !== besides && !this.#holds(id)) return id;
    }

    throw new Error(`no free site id in ${MINT_ATTEMPTS} tries`);
  }

  /** Keep a site as it is after a change, with the audit entry of that change. */
  #changed(kept: Kept, signed: Signed, action: AuditAction, detail: Readonly<Record<string, unknown>>): Done {
    this.#sites.set(kept.fields.id, kept);
    this.#log(signed, action, kept.fields, detail);

    return { kind: "done", site: siteOf(kept) };
  }

  #log(signed: Signed, action: AuditAction, site: { readonly id: SiteId; readonly name: SiteName } | null, detail: Readonly<Record<string, unknown>>): void {
    const named = site === null ? null : { id: site.id, name: site.name };

    // An entry holds its detail as JSON holds it, so what a caller changes later, or a key set to `undefined`, is not in it.
    this.#audit.push({ seq: this.#audit.length + 1, at: signed.at, by: signed.by, action, site: named, detail: JSON.parse(JSON.stringify(detail)) });
  }
}

describeDatabase("maps", (mintId) => new MemoryDatabase(mintId));
