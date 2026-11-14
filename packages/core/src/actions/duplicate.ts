// Duplicate: a new private site that holds a copy of another site's live version. The install copies the files itself, a few a call, and the copy is a site only once every file is there.
//
//   first call         the source is reached, its live version listed, an upload recorded for the copy, and the first files copied
//   each later call    names that upload: the files the copy still lacks are found, and the next ones copied
//   the last call      finishes the upload as a publish is finished, which makes the site in one step
//
// Until that step the copy is an upload: no address serves it and no listing holds it. An upload that is never finished goes as every upload does, with its files.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { parseSiteName, type SiteName } from "../names/names";
import type { Site } from "../records/site";
import { mintSiteFolder } from "../records/site";
import { type ManifestFile, mintUploadId, parseUploadId, type Upload } from "../records/upload";
import { MAX_LIST_LIMIT, type ObjectStore } from "../storage/storage";
import { checkManifest, FULL, roomUnder, type UploadLimits } from "./begin-publish";
import { defaultExpiry } from "./changes";
import { fileKey, versionPrefix } from "./files";
import { finishPublish } from "./finish-publish";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { discardUpload, isWithinReach, missingFiles, uploadKey } from "./uploads";

/** The most calls to the database and the store one call makes: the smallest plan of a host ends a request that makes more. */
const CALL_BUDGET = 50;

/** The most calls to the database before any file is copied: three to reach the source, and one to record the upload or to read it. */
const STAGE_CALLS = 4;

/** The most calls to the database that finishing a copy makes: four, and one for each of the four site ids it may draw again. */
const FINISH_CALLS = 8;

/** The list pages spared beyond the count a version's files need, for a store that hands out short pages. */
const SPARE_PAGES = 2;

/** What a copy's manifest names as every file's type, as short as a type can be: no publish declares a shorter manifest for the same files. No file is stored with it. */
const UNREAD_TYPE = "-";

/** A copy bounded by nothing but what a publish may declare. */
const UNBOUNDED: UploadLimits = { fileBytes: Number.MAX_SAFE_INTEGER, files: Number.MAX_SAFE_INTEGER };

/** What a duplicate may ask for besides its site: the `name` of the copy on the first call, or the `upload` an earlier call answered, to go on with it. */
export const DUPLICATE_REQUEST = v.strictObject({ name: v.optional(v.string()), upload: v.optional(v.string()) });

/** The codes a duplicate may be refused with. */
type DuplicateCode = Extract<Awaited<ReturnType<typeof reachSite | typeof finishPublish>>, { readonly ok: false }>["code"] | "bad_name" | "bad_path" | "no_index" | "too_large" | "too_many_sites" | "no_such_version";

/** How far a copy is: the upload that holds it, and how many of its files are stored. */
interface Progress {
  readonly upload: Upload["id"];
  readonly copied: number;
  readonly files: number;
}

/** A copy that is not a site yet: `copy.upload` is what the next call names. `copied` may equal `files` here, one call before the site is made. */
interface Copying {
  readonly ok: true;
  readonly before: null;
  readonly site: null;
  readonly copy: Progress;
}

/** A copy that is a site. */
type Duplicated = Extract<Awaited<ReturnType<typeof finishPublish>>, { readonly ok: true }> & { readonly copy: Progress };

/** A copy's plan. */
type CopyPlan = Extract<Upload["plan"], { readonly kind: "duplicate" }>;

/** The upload of a copy. */
type CopyUpload = Upload & { readonly plan: CopyPlan };

/** The upload of a copy, and the paths of its manifest the store does not hold yet. */
interface Staged {
  readonly ok: true;
  readonly upload: CopyUpload;
  readonly missing: readonly string[];
}

/** A staged copy, and whether this call recorded its upload: nobody else knows an upload no answer has named yet. */
type StagedNow = Staged & { readonly fresh: boolean };

/**
 * How many files one call copies: as many as the call budget leaves beside the database's calls and the listings, at a read and a write each.
 *
 * A copy of up to one list page of files is finished, and so listed again, in the call that copies its last file; a longer one is finished in a call of its own.
 *
 * @param files - how many files the copy holds
 * @returns 16 up to a thousand files, 21 up to two thousand, and one fewer for every two thousand more: 17 for ten thousand
 */
export function copiesPerCall(files: number): number {
  const pages = Math.ceil(files / MAX_LIST_LIMIT) + SPARE_PAGES;
  const finishing = files > MAX_LIST_LIMIT ? 0 : FINISH_CALLS + pages;

  return Math.floor((CALL_BUDGET - STAGE_CALLS - pages - finishing) / 2);
}

/**
 * List every file of one version, in one bounded listing.
 *
 * @param files - how many files the version's record says it holds, which bounds the pages
 * @throws {Error} the listing did not end inside its pages
 */
async function listVersion(store: ObjectStore, prefix: string, files: number): Promise<ManifestFile[]> {
  const listed: ManifestFile[] = [];
  let page = await store.list({ prefix });

  for (let pages = Math.ceil(files / MAX_LIST_LIMIT) + SPARE_PAGES; ; pages -= 1) {
    for (const object of page.objects) listed.push({ path: object.key.slice(prefix.length), size: object.size, content_type: UNREAD_TYPE });

    if (!page.more) return listed;

    if (pages <= 1) throw new Error(`the listing of ${prefix} did not end in the pages ${files} files need`);

    page = await store.list({ prefix, cursor: page.cursor });
  }
}

/** Record the upload of a new copy: the source's live version as it is now, under a new folder, for a private site. */
async function beginCopy(
  install: Install,
  actor: Actor,
  asked: { readonly site: Site; readonly name: SiteName; readonly settings: Parameters<typeof roomUnder>[0]; readonly now: number },
): Promise<Staged | Refused<"bad_path" | "no_index" | "too_large" | "too_many_sites" | "no_such_version">> {
  const { site, settings } = asked;
  const live = site.versions.find((version) => version.number === site.live_version);
  const manifest = await listVersion(install.store, versionPrefix(site.folder, site.live_version), live?.files ?? 0);

  // A publish that went live since the site was read may be removing this version: a listing that is not the whole version is no source.
  if (manifest.length !== live?.files) return refuse("no_such_version");

  const listed = checkManifest(manifest, { ...UNBOUNDED, perPublish: settings.max_files_per_publish });
  if (!listed.ok) return listed;

  if (listed.bytes !== live.bytes) return refuse("no_such_version");

  const folder = mintSiteFolder();
  const plan: CopyPlan = {
    kind: "duplicate",
    site: {
      name: asked.name,
      folder,
      title: site.title,
      ...(site.page_title === null ? {} : { page_title: site.page_title }),
      search_engines: site.search_engines,
      embeddable: site.embeddable,
      expires: defaultExpiry(settings.default_expires, asked.now),
      bytes: listed.bytes,
      files: manifest.length,
      access: "private",
    },
    from: { id: site.id, folder: site.folder, number: site.live_version },
  };
  const upload = { id: mintUploadId(), folder, number: 1, owner: actor.holder, plan, manifest, created_at: asked.now };
  const added = await install.database.addUpload(upload, roomUnder(settings, true, asked.now));
  if (added.kind !== "done") return FULL[added.kind];

  return { ok: true, upload: { ...upload, state: "pending", bytes: listed.bytes, files: manifest.length, dropped: [] }, missing: manifest.map((file) => file.path) };
}

/** Find the upload of a copy that an earlier call began from this site, and what it still lacks. */
async function resumeCopy(install: Install, actor: Actor, asked: { readonly site: Site; readonly reference: string; readonly now: number }): Promise<Staged | Refused<"bad_argument" | "not_found">> {
  const id = parseUploadId(asked.reference);
  if (id === undefined) return refuse("bad_argument", "upload");

  const found = await install.database.getUpload(id);
  const upload = found?.upload;
  if (found === undefined || !isWithinReach(upload, actor, asked.now)) return refuse("not_found", "upload");

  const { plan } = upload;
  if (plan.kind !== "duplicate" || plan.from.folder !== asked.site.folder) return refuse("not_found", "upload");

  const missing = upload.state === "finished" ? [] : await missingFiles(install.store, upload, found.manifest);

  return { ok: true, upload: { ...upload, plan }, missing };
}

/**
 * Copy files of the source's version to the copy's folder, each with the media type the source holds.
 *
 * @returns `false` when the source no longer holds one of them, which leaves the rest uncopied
 */
async function copyFiles(store: ObjectStore, upload: CopyUpload, paths: readonly string[]): Promise<boolean> {
  const { from: source } = upload.plan;

  for (const path of paths) {
    const from = fileKey(source.folder, source.number, path);
    const to = uploadKey(upload, path);
    if (!from.ok || !to.ok) throw new Error(`${JSON.stringify(path)} is no key of upload ${upload.id}`);

    const read = await store.read(from.key);
    if (read.kind !== "found") return false;

    await store.write(to.key, { stream: read.body, size: read.info.size }, { contentType: read.info.contentType });
  }

  return true;
}

/** Reach the source, and the upload of its copy: a new one, or the one `upload` names. */
async function stageCopy(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof DUPLICATE_REQUEST> & { readonly site: string },
): Promise<StagedNow | Refused<DuplicateCode>> {
  const reached = await reachSite(install, actor, request.site);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;
  if (site.state === "trash") return refuse("in_trash");

  if (request.upload !== undefined) {
    if (request.name !== undefined) return refuse("bad_argument", "name");

    const resumed = await resumeCopy(install, actor, { site, reference: request.upload, now: signed.at });

    return resumed.ok ? { ...resumed, fresh: false } : resumed;
  }

  const name = request.name === undefined ? ({ ok: true, value: site.name } as const) : parseSiteName(request.name);
  if (!name.ok) return refuse("bad_name", "name");

  const begun = await beginCopy(install, actor, { site, name: name.value, settings, now: signed.at });

  return begun.ok ? { ...begun, fresh: true } : begun;
}

/**
 * Copy the next files of a staged copy, and finish it once it is whole.
 *
 * A copy whose source no longer holds a file is given up and its files removed. So is one this call began that finishing refused.
 */
async function advanceCopy(install: Install, actor: Actor, staged: StagedNow, copies: number): Promise<Copying | Duplicated | Refused<DuplicateCode>> {
  const { upload, missing } = staged;
  const batch = missing.slice(0, Math.min(copies, copiesPerCall(upload.files)));

  if (!(await copyFiles(install.store, upload, batch))) {
    await discardUpload(install, upload);

    return refuse("no_such_version");
  }

  const copy: Progress = { upload: upload.id, copied: upload.files - missing.length + batch.length, files: upload.files };
  if (batch.length < missing.length) return { ok: true, before: null, site: null, copy };

  // Finishing lists the whole copy again. Past one page of files that goes into a call of its own, so no call both copies and lists that much.
  if (batch.length > 0 && upload.files > MAX_LIST_LIMIT) return { ok: true, before: null, site: null, copy };

  const finished = await finishPublish(install, actor, upload.id);
  if (finished.ok) return { ...finished, copy };

  if (staged.fresh) await discardUpload(install, upload);

  return finished;
}

/**
 * Make a new site that holds a copy of a site's live version, or go on with a copy an earlier call began: while `site` is `null` the caller calls again with `copy.upload`.
 * The copy is private whatever the source is, under a new id and a new folder, with no public name, at version 1, and its owner is the caller. Its name is the source's unless `name` is given.
 * It takes the source's typed title, its page's own title, and its search-engine and frame settings. Its expiry is a new site's, from `default_expires`: the source's is not copied.
 * The install's limits bound it as they bound a publish.
 * @param request - `site` is a reference to the source; `name` goes with the first call alone, and `upload` with every later one
 * @param copies - the most files this call copies, where that is fewer than `copiesPerCall` fits into the 50 calls to the database and the store a call may make
 * @returns the copy's progress, and the new site once every file is copied; `no_such_version` when the source stopped keeping the version meanwhile. Every refusal left no site behind
 * @throws {Error} the store or the database failed; a copy just begun is given up, and one named by `upload` stays to be gone on with
 */
export async function duplicateSite(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof DUPLICATE_REQUEST> & { readonly site: string },
  copies: number = Number.MAX_SAFE_INTEGER,
): Promise<Copying | Duplicated | Refused<DuplicateCode>> {
  const staged = await stageCopy(install, actor, request);
  if (!staged.ok) return staged;

  try {
    return await advanceCopy(install, actor, staged, copies);
  } catch (error) {
    // An upload that became a site meanwhile is left as it is.
    if (staged.fresh) await discardUpload(install, staged.upload);

    throw error;
  }
}
