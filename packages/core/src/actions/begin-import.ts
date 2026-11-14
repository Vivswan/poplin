// Begin an import: one site of a backup is checked against this install, and an upload is recorded for its files under a folder made for it. No site is made until that upload is finished.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { type PublicName, parsePublicName } from "../names/names";
import { POSITIVE } from "../records/fields";
import { mintSiteFolder, type Site, siteFromRow, siteToRow } from "../records/site";
import { MANIFEST_FILE, type ManifestFile, mintUploadId, type Upload, type UploadPlan } from "../records/upload";
import { parseSiteId } from "../sites/ids";
import { checkManifest, ENTRY_PAGE, FULL, roomUnder, type UploadLimits } from "./begin-publish";
import { BACKUP_FORMAT, type ExportedSite } from "./export";
import { enterInstall } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type UploadObject, uploadKey, uploadObject } from "./uploads";

/** An import bounded by nothing but the install's own limits. */
const UNBOUNDED: UploadLimits = { fileBytes: Number.MAX_SAFE_INTEGER, files: Number.MAX_SAFE_INTEGER };

/** The form of a site as a backup holds it, each field of its own type and none besides; what each value must be is the record's rule, checked where the site is turned into a row. A `folder` is taken and not read. */
const SENT_SITE = v.pipe(
  v.strictObject({
    id: v.string(),
    name: v.string(),
    folder: v.optional(v.unknown()),
    title: v.nullable(v.string()),
    page_title: v.nullable(v.string()),
    access: v.picklist(["private", "unlisted", "public"]),
    public_name: v.optional(v.string()),
    search_engines: v.boolean(),
    embeddable: v.boolean(),
    expires: v.union([v.literal("never"), v.number()]),
    live_version: v.number(),
    versions: v.array(v.strictObject({ number: v.number(), published_at: v.number(), published_by: v.string(), bytes: v.number(), files: v.number() })),
    owner: v.string(),
    created_at: v.number(),
    updated_at: v.number(),
    state: v.picklist(["live", "trash"]),
    trashed_at: v.optional(v.number()),
  }),
  v.check((site) => (site.access === "public") === (site.public_name !== undefined), "a public site, and no other, names its public name"),
  v.check((site) => (site.state === "trash") === (site.trashed_at !== undefined), "a site in the trash, and no other, names the moment it went there"),
);

/** What an import of one site sends: the backup's format number, the site as `exportSites` gave it, and every file of every version it carries, each named `v<number>/<path>`. */
export const IMPORT_REQUEST = v.strictObject({
  format: POSITIVE,
  site: SENT_SITE,
  files: v.array(MANIFEST_FILE),
});

/** What an import of one site sends, with the site typed as an export gives it. */
export type ImportRequest = Omit<v.InferInput<typeof IMPORT_REQUEST>, "site"> & { readonly site: ExportedSite };

/** The codes an import may be refused with as it begins. */
type ImportCode =
  | "not_allowed"
  | "not_set_up"
  | "bad_argument"
  | "backup_too_new"
  | "reserved_name"
  | "bad_path"
  | "no_index"
  | "too_large"
  | "too_many_sites"
  | "id_taken"
  | "name_taken";

/** Where an import's files go, and the site finishing it stores. */
type Placed = Pick<Upload, "folder" | "number"> & { readonly plan: UploadPlan };

/**
 * Read a site as a backup holds it, by the rules a stored site keeps, into the folder made for it. A folder sent with it is not read.
 *
 * @returns the site, and the row finishing the import reads it back from; `undefined` for a value that is no site
 */
function readSite(sent: v.InferOutput<typeof SENT_SITE>, folder: Site["folder"]): { readonly site: Site; readonly row: Readonly<Record<string, unknown>> } | undefined {
  try {
    const columns = siteToRow({ ...sent, folder } as unknown as Site);
    const row = { ...columns, versions: JSON.stringify(columns.versions) };

    return { site: siteFromRow(row), row };
  } catch {
    return undefined;
  }
}

/**
 * Check the declared files: each sits under a version the site keeps, every version has its entry page, and each version's files are as many and as long as its record says.
 *
 * One version may declare as many files as one publish; all of them together are bounded as one upload's manifest is.
 */
function checkFiles(placed: Placed & { readonly site: Site }, files: readonly ManifestFile[], limits: UploadLimits): { readonly ok: true } | Refused<"bad_argument" | "bad_path" | "no_index" | "too_large"> {
  const { versions } = placed.site;
  const prefixes = versions.map((version) => `v${version.number}/`);
  const listed = checkManifest(files, { ...limits, files: UNBOUNDED.files }, {
    isStorable: (path) => prefixes.some((prefix) => path.startsWith(prefix)) && uploadKey(placed, path).ok,
    entries: prefixes.map((prefix) => `${prefix}${ENTRY_PAGE}`),
  });
  if (!listed.ok) return listed;

  for (const [at, version] of versions.entries()) {
    const held = files.filter((file) => file.path.startsWith(prefixes[at] ?? ""));
    const bytes = held.reduce((sum, file) => sum + file.size, 0);
    if (held.length > limits.files) return refuse("too_large", "max_files");

    if (held.length !== version.files || bytes !== version.bytes) return refuse("bad_argument", "files");
  }

  return { ok: true };
}

/** Find what this install already holds that the site would take: its id or its public name. The database decides for good when the import is finished; this spares an upload that would be refused. */
async function findConflict(install: Install, site: Site): Promise<Refused<"id_taken" | "name_taken" | "reserved_name"> | undefined> {
  const { database } = install;
  if ((await database.getSite(site.id)) !== undefined) return refuse("id_taken", "id");

  if ((await database.getSiteByPublicName(site.id as string as PublicName)) !== undefined) return refuse("id_taken", "id");

  if (site.access !== "public") return undefined;

  if (!parsePublicName(site.public_name, install.reservedNames).ok) return refuse("reserved_name", "public_name");

  const asId = parseSiteId(site.public_name);
  const held = (await database.getSiteByPublicName(site.public_name)) ?? (asId.ok ? await database.getSite(asId.value) : undefined);

  return (site.public_name as string) === site.id || held !== undefined ? refuse("name_taken", "public_name") : undefined;
}

/**
 * Begin the import of one site of a backup into an install that may hold other sites.
 *
 * It checks the site's record, the files it declares, and the install's limits against the declared sizes, and refuses a site whose id or public name this install already holds.
 * Then it mints the folder the site's files go under and records the upload. Its files are sent, shown, finished, and given up as a publish's are; finishing stores the site as the backup held it. No site is made or changed here.
 * @param request - `site` is a site as `exportSites` gave it, and `files` every file of the versions it carries, each named `v<number>/<path>`; anything is taken and checked
 * @param limits - what one request can carry; a file, or one version's count of files, beyond it is `too_large`, as are versions that together declare over 10,000 files or a manifest over 1.5 MB
 * @returns the upload, whose id every later step names. `backup_too_new` for a format above the one this code reads; `id_taken` and `name_taken` name what another site holds, and nothing is recorded
 * @throws {Error} the database failed
 */
export async function beginImport(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof IMPORT_REQUEST> | ImportRequest,
  limits: UploadLimits = UNBOUNDED,
): Promise<{ readonly ok: true; readonly upload: UploadObject } | Refused<ImportCode>> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(IMPORT_REQUEST, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  if (asked.output.format > BACKUP_FORMAT) return refuse("backup_too_new", "format");

  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const folder = mintSiteFolder();
  const read = readSite(asked.output.site, folder);
  if (read === undefined) return refuse("bad_argument", "site");

  const { files } = asked.output;
  const placed: Placed = { folder, number: 1, plan: { kind: "import", site: read.row } };
  const checked = checkFiles({ ...placed, site: read.site }, files, limits);
  if (!checked.ok) return checked;

  const conflict = await findConflict(install, read.site);
  if (conflict !== undefined) return conflict;

  const upload = { ...placed, id: mintUploadId(), owner: actor.holder, manifest: files, created_at: entered.signed.at };
  const added = await install.database.addUpload(upload, roomUnder(entered.settings, true));
  if (added.kind !== "done") return FULL[added.kind];

  const bytes = files.reduce((sum, file) => sum + file.size, 0);

  return { ok: true, upload: uploadObject({ ...upload, state: "pending", bytes, files: files.length, dropped: [] }) };
}
