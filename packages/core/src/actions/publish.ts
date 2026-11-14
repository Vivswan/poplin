// Publish: a new site, or a new version of one. The files are stored first and the database row is written last, so an upload that fails is never live.

import type { Actor } from "../auth/scopes";
import type { Database, NewSite, Signed } from "../database/database";
import { parseSiteName } from "../names/names";
import type { SettingValues } from "../records/settings";
import { mintSiteFolder, type Site, type SiteAccess, type SiteFolder } from "../records/site";
import type { SiteId } from "../sites/ids";
import type { ObjectStore } from "../storage/storage";
import { applyChanges, asksNothing, type CheckedChanges, defaultExpiry, readChanges, type SiteChanges } from "./changes";
import { fileKey, removeFiles, versionPrefix } from "./files";
import { enterInstall, reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { type SiteAnswer, type SiteObject, siteAnswer } from "./site-object";

/** The page every site has at its top. */
const ENTRY_PAGE = "index.html";

/** A separator no address reaches: serving refuses a path that holds one, so a file stored under it would never be served. */
const BACKSLASH = "\\";

/** How many bytes each unit of a size setting holds. */
const BYTES_PER_UNIT = { B: 1, KB: 1000, MB: 1_000_000, GB: 1_000_000_000 } as const;

/** A folder key of the usual length, to measure a path against before the site's own folder is known. */
const ANY_FOLDER = "0".repeat(16) as SiteFolder;

/** The widest version number. A path is taken only when its key fits under it, so a site never stops taking a path as its versions grow. */
const WIDEST_VERSION = Number.MAX_SAFE_INTEGER;

/** One file of a publish. `open` starts a new read from the first byte, and the stream holds exactly `size` bytes. */
interface PublishFile {
  /** Where the file sits in the site: segments joined by `/`, with none before the first. */
  readonly path: string;

  /** The length in bytes. */
  readonly size: number;

  /** The media type the file is served with. */
  readonly contentType: string;

  open(): ReadableStream<Uint8Array>;
}

/** The files of one publish, listed before any is read. */
type PublishFiles = AsyncIterable<PublishFile> | Iterable<PublishFile>;

/**
 * What a publish asks for.
 *
 * Without `site` it makes a new site called `name`. With `site`, a reference to a site, it adds a version to that site and takes no `name`. The settings apply to either; one left out is the default on a new site and stays as it is on an update.
 */
type PublishRequest = SiteChanges & { readonly files: PublishFiles; readonly site?: string; readonly name?: string };

/** The codes a publish is refused with before the site is known. */
type EntryCode = "not_set_up" | "bad_argument" | "bad_name" | "reserved_name";

/** The codes the listed files are refused with. */
type FilesCode = "bad_argument" | "bad_path" | "no_index";

/** The codes a limit is refused with. */
type LimitCode = "too_large" | "too_many_sites";

/** The codes every publish may be refused with. */
type PublishCode = EntryCode | FilesCode | LimitCode | "name_taken" | "size_mismatch";

/** The files of a publish, checked, with the sum of their sizes. */
interface Listed {
  readonly ok: true;
  readonly files: readonly PublishFile[];
  readonly bytes: number;
}

/** A publish that is live, under the settings it was made by. `before` is the site it was published onto, `null` for a new site; `dropped` are the versions the site no longer keeps. */
interface Committed {
  readonly ok: true;
  readonly before: Site | null;
  readonly site: Site;
  readonly dropped: readonly number[];
  readonly settings: SettingValues;
}

/** The answer to a publish: the site answer with `created` on the site. `left` names the prefixes of dropped versions whose files could not be removed; it is empty when all went. */
interface Published extends SiteAnswer {
  readonly site: SiteObject & { readonly created: boolean };
  readonly left: readonly string[];
}

/** The version a publish stores its files as. */
interface Version {
  readonly folder: SiteFolder;
  readonly number: number;
  readonly files: readonly PublishFile[];
}

function bytesOf(size: SettingValues["max_site_size"]): number {
  return size.count * BYTES_PER_UNIT[size.unit];
}

/** List the files of a publish and check them, keeping each file's facts as they are now, so a caller's later change to one cannot pass unchecked. */
async function listFiles(files: PublishFiles): Promise<Listed | Refused<FilesCode>> {
  const listed: PublishFile[] = [];
  const paths = new Set<string>();
  let bytes = 0;

  for await (const file of files) {
    const { path, size, contentType } = file;
    if (typeof path !== "string" || !Number.isSafeInteger(size) || size < 0) return refuse("bad_argument", "files");

    if (paths.has(path) || path.includes(BACKSLASH) || !fileKey(ANY_FOLDER, WIDEST_VERSION, path).ok) return refuse("bad_path", path);

    paths.add(path);
    listed.push({ path, size, contentType, open: () => file.open() });
    bytes += size;
  }

  if (!paths.has(ENTRY_PAGE)) return refuse("no_index");

  return { ok: true, files: listed, bytes };
}

/**
 * Check a publish against the install's limits, before anything is written.
 *
 * `max_site_size` bounds what the site keeps once this publish is live: its bytes and those of the versions that stay under `versions_kept`. `max_total_size` bounds every kept version of every site, the trash included, with this publish on top.
 *
 * `max_sites` counts every site, the trash included: a trashed site keeps its row and its files, and can come back.
 *
 * @param onto - the site the publish adds a version to; absent for a new site
 * @returns the limit that is passed, or `undefined` when the publish fits
 */
async function passedLimit(database: Database, settings: SettingValues, publish: { readonly bytes: number; readonly onto?: Site }): Promise<Refused<LimitCode> | undefined> {
  const versions = publish.onto?.versions ?? [];
  const staying = versions.slice(Math.max(versions.length - (settings.versions_kept - 1), 0));
  const kept = staying.reduce((sum, version) => sum + version.bytes, publish.bytes);
  if (kept > bytesOf(settings.max_site_size)) return refuse("too_large", "max_site_size");

  const totals = await database.readTotals();
  if (totals.bytes + publish.bytes > bytesOf(settings.max_total_size)) return refuse("too_large", "max_total_size");

  if (publish.onto === undefined && settings.max_sites !== "none" && totals.sites >= settings.max_sites) return refuse("too_many_sites", "max_sites");

  return undefined;
}

/** Whether another site than `own` holds the public name the access asks for. The database decides for good; this spares an upload that would be refused. */
async function isHeldByAnother(database: Database, access: SiteAccess | undefined, own?: SiteId): Promise<boolean> {
  if (access?.access !== "public") return false;

  const holder = await database.getSiteByPublicName(access.public_name);

  return holder !== undefined && holder.id !== own;
}

/** Pass a file's bytes on and count them, so a stream that is not the declared size is told apart from a store that failed. */
function metered(source: ReadableStream<Uint8Array>): { readonly stream: ReadableStream<Uint8Array>; readonly differsFrom: (size: number) => boolean } {
  let bytes = 0;
  let ended = false;

  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller): void {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    flush(): void {
      ended = true;
    },
  });

  return { stream: source.pipeThrough(meter), differsFrom: (size) => bytes > size || (ended && bytes !== size) };
}

/** Store every file of a version. Answers the path of the first file whose stream is not its declared size, and stops there. */
async function storeFiles(store: ObjectStore, version: Version): Promise<string | undefined> {
  for (const file of version.files) {
    const key = fileKey(version.folder, version.number, file.path);
    if (!key.ok) throw new Error(`${JSON.stringify(file.path)} is no key of version ${version.number}: ${key.refusal}`);

    const meter = metered(file.open());

    try {
      const stored = await store.write(key.key, { stream: meter.stream, size: file.size }, { contentType: file.contentType });
      if (stored.size !== file.size) return file.path;
    } catch (error) {
      if (meter.differsFrom(file.size)) return file.path;

      throw error;
    }
  }

  return undefined;
}

/** Remove the files of a version that was not made. */
async function discard(store: ObjectStore, prefix: string, cause?: unknown): Promise<void> {
  const left = await removeFiles(store, [prefix]);
  if (left.length > 0) throw new Error(`the publish was not made, and its files under ${prefix} could not all be removed`, { cause });
}

/**
 * Store a version's files, then record it with `commit`. A version that is not recorded has its files removed.
 *
 * @throws {Error} the store or the database failed. After a failed upload the files are removed. When recording itself threw, the files stay: whether the row was written is not known, and a row must never be left without its files
 */
async function publishVersion<Code extends string>(
  store: ObjectStore,
  version: Version,
  commit: () => Promise<Committed | Refused<Code>>,
): Promise<Committed | Refused<Code | "size_mismatch">> {
  const prefix = versionPrefix(version.folder, version.number);
  let mismatched: string | undefined;

  try {
    mismatched = await storeFiles(store, version);
  } catch (error) {
    await discard(store, prefix, error);

    throw error;
  }

  if (mismatched !== undefined) {
    await discard(store, prefix);

    return refuse("size_mismatch", mismatched);
  }

  let committed: Committed | Refused<Code>;

  try {
    committed = await commit();
  } catch (error) {
    throw new Error(`the publish may or may not be recorded, so its files under ${prefix} were left in place`, { cause: error });
  }

  if (!committed.ok) await discard(store, prefix);

  return committed;
}

function draftOf(name: NewSite["name"], changes: CheckedChanges, rest: { readonly settings: SettingValues; readonly now: number; readonly listed: Listed }): NewSite {
  const { details } = changes;
  const access: SiteAccess = changes.access ?? { access: "private" };

  return {
    name,
    folder: mintSiteFolder(),
    title: details.title ?? null,
    search_engines: details.search_engines ?? rest.settings.default_search_engines,
    embeddable: details.embeddable ?? true,
    expires: details.expires ?? defaultExpiry(rest.settings.default_expires, rest.now),
    bytes: rest.listed.bytes,
    files: rest.listed.files.length,
    ...access,
  };
}

async function makeSite(
  install: Install,
  actor: Actor,
  asked: { readonly name: string | undefined; readonly changes: SiteChanges; readonly files: PublishFiles },
): Promise<Committed | Refused<PublishCode>> {
  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const { settings, signed } = entered;
  if (asked.name === undefined) return refuse("bad_argument", "name");

  const name = parseSiteName(asked.name);
  if (!name.ok) return refuse("bad_name", "name");

  const changes = readChanges(asked.changes, { name: name.value, now: signed.at });
  if (!changes.ok) return changes;

  const listed = await listFiles(asked.files);
  if (!listed.ok) return listed;

  const passed = await passedLimit(install.database, settings, { bytes: listed.bytes });
  if (passed !== undefined) return passed;

  if (await isHeldByAnother(install.database, changes.access)) return refuse("name_taken", "public_name");

  const draft = draftOf(name.value, changes, { settings, now: signed.at, listed });

  return publishVersion(install.store, { folder: draft.folder, number: 1, files: listed.files }, async () => {
    const made = await install.database.createSite(draft, signed);
    if (made.kind !== "done") return refuse(made.kind, "public_name");

    return { ok: true, before: null, site: made.site, dropped: [], settings };
  });
}

/** Record a stored version: the settings asked for first, so a refused public name leaves the site as it was, then the version. */
async function recordVersion(
  database: Database,
  site: Site,
  asked: { readonly changes: CheckedChanges; readonly number: number; readonly listed: Listed; readonly settings: SettingValues; readonly signed: Signed },
): Promise<Committed | Refused<"not_found" | "in_trash" | "name_taken" | "stale_version">> {
  if (!asksNothing(asked.changes)) {
    const applied = await applyChanges(database, site.id, asked.changes, asked.signed);
    if (!applied.ok) return applied;
  }

  const size = { bytes: asked.listed.bytes, files: asked.listed.files.length };
  const added = await database.addVersion(site.id, { number: asked.number, keep: asked.settings.versions_kept, ...size }, asked.signed);
  if (added.kind === "stale_number") return refuse("stale_version");

  if (added.kind !== "done") return refuse(added.kind);

  return { ok: true, before: site, site: added.site, dropped: added.dropped, settings: asked.settings };
}

async function addVersion(
  install: Install,
  actor: Actor,
  asked: { readonly reference: string; readonly changes: SiteChanges; readonly files: PublishFiles },
): Promise<Committed | Refused<PublishCode | "not_found" | "not_allowed" | "in_trash" | "stale_version">> {
  const reached = await reachSite(install, actor, asked.reference);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;
  if (site.state === "trash") return refuse("in_trash");

  const changes = readChanges(asked.changes, { name: site.name, now: signed.at });
  if (!changes.ok) return changes;

  const listed = await listFiles(asked.files);
  if (!listed.ok) return listed;

  const passed = await passedLimit(install.database, settings, { bytes: listed.bytes, onto: site });
  if (passed !== undefined) return passed;

  if (await isHeldByAnother(install.database, changes.access, site.id)) return refuse("name_taken", "public_name");

  const reserved = await install.database.reserveVersion(site.id);
  if (reserved.kind !== "reserved") return refuse(reserved.kind);

  const version = { folder: site.folder, number: reserved.number, files: listed.files };

  return publishVersion(install.store, version, () => recordVersion(install.database, site, { changes, number: reserved.number, listed, settings, signed }));
}

/**
 * Publish files as a new site, or as the next version of a site, and make them live.
 *
 * Nothing is written before the arguments, the file list, and the limits pass. A site needs an `index.html` at its top.
 *
 * @returns the site with `created`, the site as it was before (`null` for a new site), or a refusal that left no file and no change behind. The one exception: on an update that also asks for settings, `stale_version`, `in_trash`, or `not_found` may come after those settings were applied
 * @throws {Error} the store or the database failed; the message says when files were left behind
 */
export async function publishSite(
  install: Install,
  actor: Actor,
  request: PublishRequest,
): Promise<Published | Refused<PublishCode | "not_found" | "not_allowed" | "in_trash" | "stale_version">> {
  const { files, site: reference, name, ...changes } = request;
  if (reference !== undefined && name !== undefined) return refuse("bad_argument", "name");

  const committed = reference === undefined ? await makeSite(install, actor, { name, changes, files }) : await addVersion(install, actor, { reference, changes, files });
  if (!committed.ok) return committed;

  const left = await removeFiles(
    install.store,
    committed.dropped.map((number) => versionPrefix(committed.site.folder, number)),
  );

  const answer = siteAnswer({ before: committed.before, after: committed.site }, install, committed.settings);

  return { ...answer, site: { ...answer.site, created: reference === undefined }, left };
}
