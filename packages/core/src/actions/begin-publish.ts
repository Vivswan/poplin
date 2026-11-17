// Begin a publish: everything that needs no file body is checked, the folder or the version number is set aside, and the upload is recorded as pending. Nothing a visitor sees changes.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import type { Database, UploadRoom } from "../database/database";
import { parseSiteName, type SiteName } from "../names/names";
import { MOST_FILES_PER_PUBLISH, type SettingValues, sizeBytes } from "../records/settings";
import { mintSiteFolder, type SiteAccess, type SiteFolder } from "../records/site";
import { MANIFEST_FILE, type ManifestFile, mintUploadId, type UploadPlan } from "../records/upload";
import { dayOf } from "../records/views";
import type { ProblemKind } from "../records/problem";
import type { SiteId } from "../sites/ids";
import { type CheckedChanges, defaultExpiry, readChanges, readExpires, PAGE_TITLE_TEXT, SITE_CHANGES, type SiteChanges } from "./changes";
import { checkFilePath } from "./files";
import { noteProblem } from "./problems";
import { enterInstall, reachSite } from "./reach";
import { type Install, type Refused, type Rehearsal, refuse } from "./records";
import { type BegunUpload, begunUpload } from "./uploads";

/** The page every site has at its top. */
export const ENTRY_PAGE = "index.html";

/** The longest manifest one publish may declare, as JSON text in UTF-8 bytes: it is kept in one row, and a row holds under 2 MB. */
const MAX_MANIFEST_BYTES = 1_500_000;

/** The most uploads one holder may have pending at once: each keeps its manifest in the database until it is finished or given up. */
const MAX_PENDING_UPLOADS = 20;

/** The refusal of each bound of the room an upload did not fit. */
const FULL = {
  own_full: refuse("too_large", "max_pending_uploads"),
  folder_full: refuse("too_large", "max_site_size"),
  total_full: refuse("too_large", "max_total_size"),
  sites_full: refuse("too_many_sites", "max_sites"),
  day_full: refuse("too_large", "max_files_per_day"),
  writes_full: refuse("allowance_spent", "max_storage_writes_per_day"),
} as const;

/** The problem noted for each bound that is a limit of the day, once the day is used up. */
const DAY_LIMITS = { day_full: "files_limit_reached", writes_full: "writes_limit_reached" } as const satisfies Partial<Record<keyof typeof FULL, ProblemKind>>;

/** Measures a manifest as the database stores it. */
const UTF8 = new TextEncoder();

/** A publish bounded by nothing but the install's own limits. */
const UNBOUNDED: UploadLimits = { fileBytes: Number.MAX_SAFE_INTEGER, files: MOST_FILES_PER_PUBLISH };

/** What a publish asks for before any file is sent: its settings, `site` to add a version to that site, the `name` of a new site or the new name of that one, every file as a `MANIFEST_FILE`, and `page_title`, the entry page's own title. */
export const PUBLISH_REQUEST = v.strictObject({
  ...SITE_CHANGES.entries,
  page_title: v.optional(PAGE_TITLE_TEXT),
  site: v.optional(v.string()),
  files: v.array(MANIFEST_FILE),
});

/** What one request can carry, which bounds what a publish may declare. */
export interface UploadLimits {
  /** The longest file, in bytes. */
  readonly fileBytes: number;

  /** The most files. */
  readonly files: number;
}

/** What bounds the files a publish declares: what one request can carry, and the most files `max_files_per_publish` allows. */
type ManifestBounds = UploadLimits & { readonly perPublish: number };

/** What the database answers for an upload it did not record. */
type NotAdded = Exclude<Awaited<ReturnType<Database["addUpload"]>>, { readonly kind: "done" }>;

/** The codes a publish may be refused with as it begins. */
type BeginCode =
  | "not_set_up"
  | "bad_argument"
  | "bad_name"
  | "reserved_name"
  | "bad_path"
  | "no_index"
  | "too_large"
  | "too_many_sites"
  | "allowance_spent"
  | "name_taken"
  | "not_found"
  | "not_allowed"
  | "in_trash";

/** The settings a publish asks for besides its expiry, which is kept as typed until the upload is recorded. */
type UndatedChanges = Omit<SiteChanges, "expires">;

/** A new site as its upload records it, every field stated. */
type NewSiteDraft = Extract<UploadPlan, { readonly kind: "create" }>["site"];

/** The next version of a site as its upload records it. */
type UpdatePlan = Extract<UploadPlan, { readonly kind: "update" }>;

/** Each member of a union of records, without its expiry. */
type Undated<Dated> = Dated extends unknown ? Omit<Dated, "expires"> : never;

/** What finishing a planned publish makes, with the expiry as it was asked and not yet a moment: `expires` is the text typed, or for none typed the install's `default_expires` on a new site and `undefined` on an update, which keeps the site's own. */
type UndatedPlan =
  | { readonly kind: "create"; readonly site: Undated<NewSiteDraft>; readonly expires: string | SettingValues["default_expires"] }
  | (Omit<UpdatePlan, "details"> & { readonly details: Omit<UpdatePlan["details"], "expires">; readonly expires: string | undefined });

/** What a manifest is held to besides its sizes: which paths can be stored, and the pages it must name. */
interface ManifestRules {
  readonly isStorable: (path: string) => boolean;
  readonly entries: readonly string[];
}

/** A manifest that passed, with the sum of its sizes. */
interface Listed {
  readonly ok: true;
  readonly bytes: number;
}

/** What the upload is recorded with: where its files go, what finishing it makes, and the room the limits leave it. `site` is the site it is the next version of, whose number is set aside as the upload is recorded; a new site has none. */
interface Planned {
  readonly ok: true;
  readonly folder: SiteFolder;
  readonly site?: SiteId;
  readonly plan: UndatedPlan;
  readonly room: UploadRoom;
}

/**
 * Check how many files are declared against the install's own count and what one request can carry.
 *
 * @returns `undefined` for a count that fits, or `too_large` about the bound it passes
 */
export function checkCount(files: number, bounds: Pick<ManifestBounds, "perPublish" | "files">): Refused<"too_large"> | undefined {
  if (files > bounds.perPublish) return refuse("too_large", "max_files_per_publish");

  if (files > Math.min(bounds.files, MOST_FILES_PER_PUBLISH)) return refuse("too_large", "max_files");

  return undefined;
}

/**
 * Check the declared files against the path rules, the install's own count, and what one request can carry.
 *
 * @param rules - a publish's by default: a path whose key fits under any version, and the entry page
 * @returns the sum of the sizes, or the first rule a file or the whole manifest breaks; more files than the setting allows are `too_large` about `max_files_per_publish`
 */
export function checkManifest(
  files: readonly ManifestFile[],
  bounds: ManifestBounds,
  rules: ManifestRules = { isStorable: (path) => checkFilePath(path).ok, entries: [ENTRY_PAGE] },
): Listed | Refused<"bad_path" | "no_index" | "too_large"> {
  const counted = checkCount(files.length, bounds);
  if (counted !== undefined) return counted;

  const paths = new Set<string>();
  let bytes = 0;

  for (const { path, size } of files) {
    if (paths.has(path) || !rules.isStorable(path)) return refuse("bad_path", path);

    if (size > bounds.fileBytes) return refuse("too_large", "max_file_size");

    paths.add(path);
    bytes += size;
  }

  if (rules.entries.some((entry) => !paths.has(entry))) return refuse("no_index");

  if (UTF8.encode(JSON.stringify(files)).length > MAX_MANIFEST_BYTES) return refuse("too_large", "max_manifest_size");

  return { ok: true, bytes };
}

/**
 * Refuse an upload that did not fit its room. A limit of the day is noted as a problem only once the day is used up: an upload too large for what is left is refused and nothing more, since a smaller one still fits.
 *
 * @param full - what the database said the upload did not fit
 * @param how - with `dry_run` no problem is noted
 */
export async function refuseFull(install: Pick<Install, "database" | "now">, full: NotAdded, how: Rehearsal = {}): Promise<(typeof FULL)[keyof typeof FULL]> {
  if (how.dry_run !== true && "left" in full && full.left === 0) await noteProblem(install, DAY_LIMITS[full.kind]);

  return FULL[full.kind];
}

/**
 * The room a publish must fit in under the install's limits. The database checks it in the step that records the upload, so uploads begun at the same moment cannot pass a limit together.
 * `max_site_size` bounds what the site keeps once this publish is live: the versions that stay under `versions_kept`, this publish, and every other pending upload to the site.
 * `max_total_size` bounds every kept version of every site, the trash included, and every pending upload, whose files are in the bucket already.
 * `max_sites` counts every site, the trash included, and every pending upload of a new site. One holder has at most 20 uploads pending.
 * `max_files_per_day` bounds the files every upload begun on the same UTC day declares; an upload that is given up or runs out gives none back.
 * `max_storage_writes_per_day` bounds the times the store is written to or listed on one UTC day: the upload's `writes` are counted on the day it begins.
 * @param upload - `makesSite` is whether finishing it makes a site, which `max_sites` then bounds; `writes` is how many times it writes to the store: once a file, twice a copied file
 * @param now - the clock, in milliseconds since the epoch: the day the upload's files are counted on
 */
export function roomUnder(settings: SettingValues, upload: { readonly makesSite: boolean; readonly writes: number }, now: number): UploadRoom {
  const { makesSite } = upload;

  return {
    day: dayOf(now),
    dayFiles: settings.max_files_per_day,
    writes: upload.writes,
    dayWrites: settings.max_storage_writes_per_day,
    own: MAX_PENDING_UPLOADS,
    folderBytes: sizeBytes(settings.max_site_size),
    staying: settings.versions_kept - 1,
    totalBytes: sizeBytes(settings.max_total_size),
    sites: makesSite && settings.max_sites !== "none" ? settings.max_sites : null,
  };
}

/** Whether another site than `own` holds the public name the access asks for. The database decides for good when the upload is finished; this spares an upload that would be refused. */
async function isHeldByAnother(database: Database, access: SiteAccess | undefined, own?: SiteId): Promise<boolean> {
  if (access?.access !== "public") return false;

  const holder = await database.getSiteByPublicName(access.public_name);

  return holder !== undefined && holder.id !== own;
}

/** The page's own title as an upload's plan keeps it: the key is absent for a page with none. */
function pageTitleOf(sent: string | undefined): { readonly page_title?: string } {
  return sent === undefined || sent === "" ? {} : { page_title: sent };
}

/** Whether an expiry as typed names no moment after `now`: it is in no known form, or its moment is not ahead. None typed is none past. */
function isBadExpiry(typed: string | undefined, now: number): boolean {
  return typed !== undefined && readExpires(typed, now) === undefined;
}

/**
 * Give a planned publish its expiry: a span, typed or the install's default, is counted from `now`, and a typed moment must still lie after it.
 *
 * @param now - the moment the upload is recorded, in milliseconds since the epoch
 * @returns what finishing the upload makes, or the refusal of a typed moment that is no longer ahead
 */
function datedPlan(planned: UndatedPlan, now: number): UploadPlan | Refused<"bad_argument"> {
  if (planned.kind === "create") {
    const { expires: asked, ...plan } = planned;
    const expires = typeof asked === "string" ? readExpires(asked, now) : defaultExpiry(asked, now);

    return expires === undefined ? refuse("bad_argument", "expires") : { kind: "create", site: { ...plan.site, expires } };
  }

  const { expires: asked, ...plan } = planned;
  if (asked === undefined) return plan;

  const expires = readExpires(asked, now);

  return expires === undefined ? refuse("bad_argument", "expires") : { ...plan, details: { ...plan.details, expires } };
}

function draftOf(
  name: SiteName,
  changes: CheckedChanges,
  rest: { readonly settings: SettingValues; readonly listed: Listed; readonly files: number; readonly pageTitle: string | undefined },
): Undated<NewSiteDraft> {
  const { details } = changes;
  const access: SiteAccess = changes.access ?? { access: "private" };

  return {
    name,
    ...pageTitleOf(rest.pageTitle),
    folder: mintSiteFolder(),
    title: details.title ?? null,
    search_engines: details.search_engines ?? rest.settings.default_search_engines,
    embeddable: details.embeddable ?? true,
    bytes: rest.listed.bytes,
    files: rest.files,
    ...access,
  };
}

async function planSite(
  install: Install,
  actor: Actor,
  asked: { readonly name: string | undefined; readonly changes: UndatedChanges; readonly expires: string | undefined; readonly pageTitle: string | undefined; readonly files: readonly ManifestFile[]; readonly limits: UploadLimits },
): Promise<Planned | Refused<BeginCode>> {
  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const { settings, signed } = entered;
  if (asked.name === undefined) return refuse("bad_argument", "name");

  const name = parseSiteName(asked.name);
  if (!name.ok) return refuse("bad_name", "name");

  const changes = readChanges(asked.changes, { name: name.value, now: signed.at, reserved: install.reservedNames });
  if (!changes.ok) return changes;

  if (isBadExpiry(asked.expires, signed.at)) return refuse("bad_argument", "expires");

  const listed = checkManifest(asked.files, { ...asked.limits, perPublish: settings.max_files_per_publish });
  if (!listed.ok) return listed;

  if (await isHeldByAnother(install.database, changes.access)) return refuse("name_taken", "public_name");

  const site = draftOf(name.value, changes, { settings, listed, files: asked.files.length, pageTitle: asked.pageTitle });

  return { ok: true, folder: site.folder, plan: { kind: "create", site, expires: asked.expires ?? settings.default_expires }, room: roomUnder(settings, { makesSite: true, writes: asked.files.length }, signed.at) };
}

async function planVersion(
  install: Install,
  actor: Actor,
  asked: { readonly reference: string; readonly changes: UndatedChanges; readonly expires: string | undefined; readonly pageTitle: string | undefined; readonly files: readonly ManifestFile[]; readonly limits: UploadLimits },
): Promise<Planned | Refused<BeginCode>> {
  const reached = await reachSite(install, actor, asked.reference);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;
  if (site.state === "trash") return refuse("in_trash");

  const changes = readChanges(asked.changes, { name: site.name, current: site, now: signed.at, reserved: install.reservedNames });
  if (!changes.ok) return changes;

  if (isBadExpiry(asked.expires, signed.at)) return refuse("bad_argument", "expires");

  const listed = checkManifest(asked.files, { ...asked.limits, perPublish: settings.max_files_per_publish });
  if (!listed.ok) return listed;

  if (await isHeldByAnother(install.database, changes.access, site.id)) return refuse("name_taken", "public_name");

  const asks = changes.access === undefined ? { details: changes.details } : { access: changes.access, details: changes.details };
  const plan: UndatedPlan = { kind: "update", ...asks, ...pageTitleOf(asked.pageTitle), expires: asked.expires };

  return { ok: true, folder: site.folder, site: site.id, plan, room: roomUnder(settings, { makesSite: false, writes: asked.files.length }, signed.at) };
}

/**
 * Check a publish: everything `beginPublish` does before it writes. No version number is set aside and nothing is recorded.
 *
 * @param request - what the caller sent; anything is taken and checked
 * @param limits - what one request can carry, as `beginPublish` takes it
 * @returns where the files go and what finishing makes, with the files as they were declared and the expiry as it was asked, or the refusal `beginPublish` answers, which leaves nothing behind
 * @throws {Error} the database failed
 */
export async function planUpload(
  install: Install,
  actor: Actor,
  request: unknown,
  limits: UploadLimits = UNBOUNDED,
): Promise<(Planned & { readonly files: readonly ManifestFile[] }) | Refused<BeginCode>> {
  const asked = v.safeParse(PUBLISH_REQUEST, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  const { files, site: reference, name, page_title: pageTitle, expires, ...changes } = asked.output;
  const renamed = name === undefined ? changes : { ...changes, name };

  const planned =
    reference === undefined
      ? await planSite(install, actor, { name, changes, expires, pageTitle, files, limits })
      : await planVersion(install, actor, { reference, changes: renamed, expires, pageTitle, files, limits });

  return planned.ok ? { ...planned, files } : planned;
}

/**
 * Record a planned publish as a pending upload, in the room the install's limits leave it. The next version number of a site is set aside here, so a publish that is never recorded skips none.
 * The site's expiry becomes a moment here: a span, typed or the install's default, is counted from this moment and not from the plan's.
 *
 * @param planned - what `planUpload` answered
 * @param hashes - the hash each planned file is recorded with, in the order of the files, for a plan made before the files were read; the planned ones when left out
 * @returns the upload, with the tickets its files are sent by when it declares at most 100, or the refusal of a limit it did not fit, which leaves nothing behind but a version number that is skipped.
 * `bad_argument` about `expires` for a typed moment that passed since the plan, which leaves nothing behind
 * @throws {Error} the database failed, or the hashes are not as many as the files
 */
export async function recordUpload(install: Install, actor: Actor, planned: Extract<Awaited<ReturnType<typeof planUpload>>, { readonly ok: true }>, hashes?: readonly string[]): Promise<BegunUpload | Refused<BeginCode>> {
  if (hashes !== undefined && hashes.length !== planned.files.length) throw new Error(`${hashes.length} hashes for ${planned.files.length} files`);

  const files = hashes === undefined ? planned.files : planned.files.map((file, at) => ({ ...file, sha256: hashes[at] as string }));
  const now = install.now();
  // A site's expiry is counted from here and not from the plan, which the reading of the files may lie long after.
  const plan = datedPlan(planned.plan, now);
  if ("ok" in plan) return plan;

  const reserved = planned.site === undefined ? { kind: "reserved", number: 1 } as const : await install.database.reserveVersion(planned.site);
  if (reserved.kind !== "reserved") return refuse(reserved.kind);

  const upload = { id: mintUploadId(), folder: planned.folder, number: reserved.number, owner: actor.holder, plan, manifest: files, created_at: now };
  // The day's limits are those of the day the upload is recorded on, which a plan made before midnight may not be.
  const added = await install.database.addUpload(upload, { ...planned.room, day: dayOf(upload.created_at) });
  if (added.kind !== "done") return refuseFull(install, added);

  const bytes = files.reduce((sum, file) => sum + file.size, 0);

  return begunUpload(install, { ...upload, state: "pending", bytes, files: files.length, dropped: [] }, files);
}

/**
 * Begin a publish of a new site, or of the next version of a site, which a `name` sent with it renames.
 * It checks the arguments, the actor's right to the site, the paths, and the limits against the declared sizes. A site needs an `index.html` at its top.
 * Then it mints the folder of a new site or sets aside the site's next version number, and records the upload. No file is stored, no site is made, and no site changes.
 * @param request - what the caller sent; anything is taken and checked
 * @param limits - what one request can carry; a file or a count beyond it is `too_large`, naming `max_file_size` or `max_files`. A count beyond the install's settings names `max_files_per_publish` or `max_files_per_day`
 * @returns the upload, whose id every later step names, with the tickets its files are sent by when it declares at most 100, or a refusal that left nothing behind but a version number that is skipped.
 * `allowance_spent` about `max_storage_writes_per_day` when the day's writes to the store leave no room for its files, until the next midnight UTC
 * @throws {Error} the database failed
 */
export async function beginPublish(
  install: Install,
  actor: Actor,
  request: unknown,
  limits: UploadLimits = UNBOUNDED,
): Promise<BegunUpload | Refused<BeginCode>> {
  const planned = await planUpload(install, actor, request, limits);
  if (!planned.ok) return planned;

  return recordUpload(install, actor, planned);
}
