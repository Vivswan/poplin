// Begin a publish: everything that needs no file body is checked, the folder or the version number is set aside, and the upload is recorded as pending. Nothing a visitor sees changes.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import type { Database, UploadRoom } from "../database/database";
import { parseSiteName, type SiteName } from "../names/names";
import { type SettingValues, sizeBytes } from "../records/settings";
import { mintSiteFolder, type SiteAccess, type SiteFolder } from "../records/site";
import { MANIFEST_FILE, type ManifestFile, mintUploadId, type UploadPlan } from "../records/upload";
import type { SiteId } from "../sites/ids";
import { type CheckedChanges, defaultExpiry, readChanges, SITE_CHANGES, type SiteChanges, TITLE_TEXT } from "./changes";
import { checkFilePath } from "./files";
import { enterInstall, reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type UploadObject, uploadObject } from "./uploads";

/** The page every site has at its top. */
export const ENTRY_PAGE = "index.html";

/** The most files one publish may declare, whatever the caller allows: finishing lists them a thousand a store call. */
const MAX_FILES = 10_000;

/** The longest manifest one publish may declare, as JSON text in UTF-8 bytes: it is kept in one row, and a row holds under 2 MB. */
const MAX_MANIFEST_BYTES = 1_500_000;

/** The most uploads one holder may have pending at once: each keeps its manifest in the database until it is finished or given up. */
const MAX_PENDING_UPLOADS = 20;

/** The refusal of each bound of the room an upload did not fit. */
export const FULL = {
  own_full: refuse("too_large", "max_pending_uploads"),
  folder_full: refuse("too_large", "max_site_size"),
  total_full: refuse("too_large", "max_total_size"),
  sites_full: refuse("too_many_sites", "max_sites"),
} as const;

/** Measures a manifest as the database stores it. */
const UTF8 = new TextEncoder();

/** A publish bounded by nothing but the install's own limits. */
const UNBOUNDED: UploadLimits = { fileBytes: Number.MAX_SAFE_INTEGER, files: MAX_FILES };

/** What a publish asks for before any file is sent: its settings, `site` to add a version to that site or else the `name` of a new one, every file with its size and content type, and `page_title`, the entry page's own title. */
export const PUBLISH_REQUEST = v.strictObject({
  ...SITE_CHANGES.entries,
  page_title: v.optional(TITLE_TEXT),
  site: v.optional(v.string()),
  name: v.optional(v.string()),
  files: v.array(MANIFEST_FILE),
});

/** What one request can carry, which bounds what a publish may declare. */
export interface UploadLimits {
  /** The longest file, in bytes. */
  readonly fileBytes: number;

  /** The most files. */
  readonly files: number;
}

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
  | "name_taken"
  | "not_found"
  | "not_allowed"
  | "in_trash";

/** A new site as its upload records it, every field stated. */
type NewSiteDraft = Extract<UploadPlan, { readonly kind: "create" }>["site"];

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

/** What the upload is recorded with: where its files go, what finishing it makes, and the room the limits leave it. */
interface Planned {
  readonly ok: true;
  readonly folder: SiteFolder;
  readonly number: number;
  readonly plan: UploadPlan;
  readonly room: UploadRoom;
}

/**
 * Check the declared files against the path rules and against what one request can carry.
 *
 * @param rules - a publish's by default: a path whose key fits under any version, and the entry page
 * @returns the sum of the sizes, or the first rule a file or the whole manifest breaks
 */
export function checkManifest(
  files: readonly ManifestFile[],
  limits: UploadLimits,
  rules: ManifestRules = { isStorable: (path) => checkFilePath(path).ok, entries: [ENTRY_PAGE] },
): Listed | Refused<"bad_path" | "no_index" | "too_large"> {
  if (files.length > Math.min(limits.files, MAX_FILES)) return refuse("too_large", "max_files");

  const paths = new Set<string>();
  let bytes = 0;

  for (const { path, size } of files) {
    if (paths.has(path) || !rules.isStorable(path)) return refuse("bad_path", path);

    if (size > limits.fileBytes) return refuse("too_large", "max_file_size");

    paths.add(path);
    bytes += size;
  }

  if (rules.entries.some((entry) => !paths.has(entry))) return refuse("no_index");

  if (UTF8.encode(JSON.stringify(files)).length > MAX_MANIFEST_BYTES) return refuse("too_large", "max_manifest_size");

  return { ok: true, bytes };
}

/**
 * The room a publish must fit in under the install's limits. The database checks it in the step that records the upload, so uploads begun at the same moment cannot pass a limit together.
 *
 * `max_site_size` bounds what the site keeps once this publish is live: the versions that stay under `versions_kept`, this publish, and every other pending upload to the site.
 * `max_total_size` bounds every kept version of every site, the trash included, and every pending upload, whose files are in the bucket already.
 * `max_sites` counts every site, the trash included, and every pending upload of a new site. One holder has at most 20 uploads pending.
 *
 * @param makesSite - whether finishing the upload makes a site, which `max_sites` then bounds
 */
export function roomUnder(settings: SettingValues, makesSite: boolean): UploadRoom {
  return {
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

function draftOf(
  name: SiteName,
  changes: CheckedChanges,
  rest: { readonly settings: SettingValues; readonly now: number; readonly listed: Listed; readonly files: number; readonly pageTitle: string | undefined },
): NewSiteDraft {
  const { details } = changes;
  const access: SiteAccess = changes.access ?? { access: "private" };

  return {
    name,
    ...pageTitleOf(rest.pageTitle),
    folder: mintSiteFolder(),
    title: details.title ?? null,
    search_engines: details.search_engines ?? rest.settings.default_search_engines,
    embeddable: details.embeddable ?? true,
    expires: details.expires ?? defaultExpiry(rest.settings.default_expires, rest.now),
    bytes: rest.listed.bytes,
    files: rest.files,
    ...access,
  };
}

async function planSite(
  install: Install,
  actor: Actor,
  asked: { readonly name: string | undefined; readonly changes: SiteChanges; readonly pageTitle: string | undefined; readonly files: readonly ManifestFile[]; readonly limits: UploadLimits },
): Promise<Planned | Refused<BeginCode>> {
  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const { settings, signed } = entered;
  if (asked.name === undefined) return refuse("bad_argument", "name");

  const name = parseSiteName(asked.name);
  if (!name.ok) return refuse("bad_name", "name");

  const changes = readChanges(asked.changes, { name: name.value, now: signed.at, reserved: install.reservedNames });
  if (!changes.ok) return changes;

  const listed = checkManifest(asked.files, asked.limits);
  if (!listed.ok) return listed;

  if (await isHeldByAnother(install.database, changes.access)) return refuse("name_taken", "public_name");

  const site = draftOf(name.value, changes, { settings, now: signed.at, listed, files: asked.files.length, pageTitle: asked.pageTitle });

  return { ok: true, folder: site.folder, number: 1, plan: { kind: "create", site }, room: roomUnder(settings, true) };
}

async function planVersion(
  install: Install,
  actor: Actor,
  asked: { readonly reference: string; readonly changes: SiteChanges; readonly pageTitle: string | undefined; readonly files: readonly ManifestFile[]; readonly limits: UploadLimits },
): Promise<Planned | Refused<BeginCode>> {
  const reached = await reachSite(install, actor, asked.reference);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;
  if (site.state === "trash") return refuse("in_trash");

  const changes = readChanges(asked.changes, { name: site.name, current: site, now: signed.at, reserved: install.reservedNames });
  if (!changes.ok) return changes;

  const listed = checkManifest(asked.files, asked.limits);
  if (!listed.ok) return listed;

  if (await isHeldByAnother(install.database, changes.access, site.id)) return refuse("name_taken", "public_name");

  const reserved = await install.database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") return refuse(reserved.kind);

  const asks = changes.access === undefined ? { details: changes.details } : { access: changes.access, details: changes.details };
  const plan: UploadPlan = { kind: "update", ...asks, ...pageTitleOf(asked.pageTitle) };

  return { ok: true, folder: site.folder, number: reserved.number, plan, room: roomUnder(settings, false) };
}

/**
 * Begin a publish of a new site, or of the next version of a site.
 *
 * It checks the arguments, the actor's right to the site, the paths, and the limits against the declared sizes. A site needs an `index.html` at its top.
 * Then it mints the folder of a new site or sets aside the site's next version number, and records the upload. No file is stored, no site is made, and no site changes.
 * @param request - what the caller sent; anything is taken and checked
 * @param limits - what one request can carry; a file or a count beyond it is `too_large`, naming `max_file_size` or `max_files`
 * @returns the upload, whose id every later step names, or a refusal that left nothing behind but a version number that is skipped
 * @throws {Error} the database failed
 */
export async function beginPublish(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof PUBLISH_REQUEST>,
  limits: UploadLimits = UNBOUNDED,
): Promise<{ readonly ok: true; readonly upload: UploadObject } | Refused<BeginCode>> {
  const asked = v.safeParse(PUBLISH_REQUEST, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  const { files, site: reference, name, page_title: pageTitle, ...changes } = asked.output;
  if (reference !== undefined && name !== undefined) return refuse("bad_argument", "name");

  const planned = reference === undefined ? await planSite(install, actor, { name, changes, pageTitle, files, limits }) : await planVersion(install, actor, { reference, changes, pageTitle, files, limits });
  if (!planned.ok) return planned;

  const upload = { id: mintUploadId(), folder: planned.folder, number: planned.number, owner: actor.holder, plan: planned.plan, manifest: files, created_at: install.now() };
  const added = await install.database.addUpload(upload, planned.room);
  if (added.kind !== "done") return FULL[added.kind];

  const bytes = files.reduce((sum, file) => sum + file.size, 0);

  return { ok: true, upload: uploadObject({ ...upload, state: "pending", bytes, files: files.length, dropped: [] }) };
}
