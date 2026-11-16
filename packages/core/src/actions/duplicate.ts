// Duplicate: a new private site that holds a copy of another site's live version. The install copies the files itself, some a call, and the copy is a site only once every file is there.
//
//   first call         the source is reached, its live version listed, an upload recorded for the copy, and the first files copied; a copy that is not whole then is started as a job
//   each later round   the files the copy still lacks are found, and the next ones copied
//   the last round     finishes the upload as a publish is finished, which makes the site in one step
//
// Who runs the later rounds is the host's part. Where it runs jobs by itself, the copy goes on with nobody asking, and a later call is only told whether the copy is a site yet.
// Anywhere else each later call, which names the upload, runs one round.
//
// Until the last step the copy is an upload: no address serves it and no listing holds it. An upload that is never finished goes as every upload does, with its files.

import pMap from "p-map";
import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { parseSiteName, type SiteName } from "../names/names";
import type { Jobs } from "../jobs/jobs";
import { COUNT, POSITIVE } from "../records/fields";
import type { Site } from "../records/site";
import { mintSiteFolder } from "../records/site";
import { type ManifestFile, mintUploadId, parseUploadId, UPLOAD_ID, type Upload, type UploadId } from "../records/upload";
import { dayOf } from "../records/views";
import { MAX_LIST_LIMIT, type ObjectStore } from "../storage/storage";
import { abandonPublish } from "./abandon-publish";
import { checkManifest, refuseFull, roomUnder, type UploadLimits } from "./begin-publish";
import { cutTitle, defaultExpiry, MAX_TITLE_LENGTH } from "./changes";
import { fileKey, versionPrefix } from "./files";
import { finishPublish, PUBLISHED_SITE } from "./finish-publish";
import { noteProblem } from "./problems";
import { reachSite } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { CLEANUP_CALLS, discardUpload, isWithinReach, missingFiles, removeUploadFiles, uploadKey } from "./uploads";

/** The most calls to the database one request that copies makes, whoever asks: six under the 50 past which the smallest plan of a host ends a request, so a count that is off by a few still fits. */
const DATABASE_BUDGET = 44;

/** The most calls to the store one request that copies makes: a quarter of the 1,000 the smallest plan of a host gives a request. */
const STORE_BUDGET = 250;

/** The most calls to the database a host makes of its own in a request that starts it, which any request of a copy may be. */
const START_CALLS = 2;

/** The most calls to the database before any file is copied: three to reach the source, and one to record the upload or to read it. */
const STAGE_CALLS = 4;

/** The calls to the database that counting a call's listings against the day costs whoever runs it: the first listing's place taken, and the later ones written after the last. */
const COUNT_CALLS = 2;

/** The most calls to the database that finishing a copy makes: four, and one for each of the four site ids it may draw again. */
const FINISH_CALLS = 8;

/** The calls to the database that giving up a copy which failed makes. */
const GIVE_UP_CALLS = 2;

/** The calls to the store one copied file costs: a read and a write. Both are counted against the day's writes, when the copy begins. */
export const COPY_CALLS = 2;

/** How many files of a copy are on their way at once: as many connections as a host lets one request hold open. */
const COPIES_AT_ONCE = 6;

/** The list pages spared beyond the count a version's files need, for a store that hands out short pages. */
const SPARE_PAGES = 2;

/** What a copy's manifest names as every file's type, as short as a type can be: no publish declares a shorter manifest for the same files. No file is stored with it. */
const UNREAD_TYPE = "-";

/** What a copy's manifest names as every file's hash: none. A file is copied with the hash the source holds, which the store holds its bytes to. */
const UNREAD_HASH = "";

/** A copy bounded by nothing but what a publish may declare. */
const UNBOUNDED: UploadLimits = { fileBytes: Number.MAX_SAFE_INTEGER, files: Number.MAX_SAFE_INTEGER };

/** What the title of a copy ends with. */
const COPY_MARK = " (copy)";

/** What a duplicate may ask for besides its site: the `name` of the copy on the first call, or the `upload` an earlier call answered, to go on with it. */
export const DUPLICATE_REQUEST = v.strictObject({ name: v.optional(v.string()), upload: v.optional(v.string()) });

/** How far a copy is: the upload that holds it, and how many of its files are stored. `copied` is `null` while the install copies with nobody asking: no call counts the files then. */
const PROGRESS = v.object({ upload: UPLOAD_ID, copied: v.nullable(COUNT), files: POSITIVE });

/** A copy that is not a site yet: `copy.upload` is what the next call names. `copied` may equal `files` here, one round before the site is made. */
const COPYING = v.object({ before: v.null(), site: v.null(), copy: PROGRESS });

/** A copy that is a site. */
const COPIED = v.object({ ...PUBLISHED_SITE.entries, copy: PROGRESS });

/** What a duplicate answers: the copy's progress, and the new site once every file is copied. */
export const DUPLICATED_SITE = v.union([COPYING, COPIED]);

/** The codes a duplicate may be refused with. */
type DuplicateCode = Extract<Awaited<ReturnType<typeof reachSite | typeof finishPublish>>, { readonly ok: false }>["code"] | "bad_name" | "bad_path" | "no_index" | "too_large" | "too_many_sites" | "allowance_spent" | "no_such_version";

/** How far a copy is. */
type Progress = Readonly<v.InferOutput<typeof PROGRESS>>;

/** A copy that is not a site yet. */
type Copying = { readonly ok: true } & Readonly<v.InferOutput<typeof COPYING>>;

/** A copy that is a site. */
type Duplicated = { readonly ok: true } & Readonly<v.InferOutput<typeof COPIED>>;

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

/** The upload of a copy that the install copies with nobody asking: its files are not listed. */
type Watched = Omit<Staged, "missing"> & { readonly missing: null };

/** A staged copy, and whether this call recorded its upload: nobody else knows an upload no answer has named yet. */
type StagedNow = Staged & { readonly fresh: boolean };

/**
 * How many files one call copies: as many as the store's budget leaves beside the listings and the removal of a copy that fails, at a read and a write each. The calls to the database do not grow with the files.
 *
 * A copy of up to one list page of files is finished, and so listed again, in the call that copies its last file; a longer one is finished in a call of its own.
 *
 * @param files - how many files the copy holds
 * @returns 112 up to a thousand files, 113 up to two thousand, and one fewer for every two thousand more: 109 for ten thousand
 */
function copiesPerCall(files: number): number {
  const pages = Math.ceil(files / MAX_LIST_LIMIT) + SPARE_PAGES;
  const finishing = files > MAX_LIST_LIMIT ? 0 : pages;

  return Math.floor((STORE_BUDGET - CLEANUP_CALLS - pages - finishing) / COPY_CALLS);
}

/** The most calls to the database one request of a copy makes: the host's start, the caller's own, and the action's, which at most finishes the copy and gives it up if that fails. A call whose writes fail finishes nothing, and counts them in fewer. */
function databaseCalls(asking: number): number {
  return START_CALLS + asking + STAGE_CALLS + COUNT_CALLS + FINISH_CALLS + GIVE_UP_CALLS;
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
    for (const object of page.objects) listed.push({ path: object.key.slice(prefix.length), size: object.size, content_type: UNREAD_TYPE, sha256: UNREAD_HASH });

    if (!page.more) return listed;

    if (pages <= 1) throw new Error("the listing of a version did not end in the pages its files need");

    page = await store.list({ prefix, cursor: page.cursor });
  }
}

/**
 * The title a copy is given: the one its source shows, which is the typed one or else its page's own, with ` (copy)` after it. The title is cut to make room, and the mark never is.
 *
 * @returns the source's typed title as it is, for a source that shows no title and so shows its name, or one whose title ends in the mark already
 */
function copyTitle(site: Site): string | null {
  const shown = site.title ?? site.page_title;
  if (shown === null || shown.endsWith(COPY_MARK)) return site.title;

  return `${cutTitle(shown, MAX_TITLE_LENGTH - COPY_MARK.length).trimEnd()}${COPY_MARK}`;
}

/** Record the upload of a new copy: the source's live version as it is now, under a new folder, for a private site. */
async function beginCopy(
  install: Install,
  actor: Actor,
  asked: { readonly site: Site; readonly name: SiteName; readonly settings: Parameters<typeof roomUnder>[0]; readonly now: number },
): Promise<Staged | Refused<"bad_path" | "no_index" | "too_large" | "too_many_sites" | "allowance_spent" | "no_such_version">> {
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
      title: copyTitle(site),
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
  const added = await install.database.addUpload(upload, roomUnder(settings, { makesSite: true, writes: manifest.length * COPY_CALLS }, asked.now));
  if (added.kind !== "done") return refuseFull(install, added);

  return { ok: true, upload: { ...upload, state: "pending", bytes: listed.bytes, files: manifest.length, dropped: [] }, missing: manifest.map((file) => file.path) };
}

/** Find the upload of a copy that an earlier call began from this site, and what it still lacks. A copy the install is at with nobody asking is found, and not listed. */
async function resumeCopy(
  install: Install,
  actor: Actor,
  asked: { readonly site: Site; readonly reference: string; readonly now: number; readonly watching: boolean },
): Promise<Staged | Watched | Refused<"bad_argument" | "not_found">> {
  const id = parseUploadId(asked.reference);
  if (id === undefined) return refuse("bad_argument", "upload");

  const found = await install.database.getUpload(id);
  const upload = found?.upload;
  if (found === undefined || !isWithinReach(upload, actor, asked.now)) return refuse("not_found", "upload");

  const { plan } = upload;
  if (plan.kind !== "duplicate" || plan.from.folder !== asked.site.folder) return refuse("not_found", "upload");

  if (upload.state === "finished") return { ok: true, upload: { ...upload, plan }, missing: [] };

  if (asked.watching) return { ok: true, upload: { ...upload, plan }, missing: null };

  return { ok: true, upload: { ...upload, plan }, missing: await missingFiles(install.store, upload, found.manifest) };
}

/** The files of one call that are on their way: how they ended, once one is missing or fails, after which none is begun, and how many writes the store did not keep. A failure outranks a missing file. */
interface Batch {
  ended?: { readonly kind: "missing" } | { readonly kind: "failed"; readonly failure: unknown };
  unkept: number;
}

/** End a batch at a failure. The first one is the one told. */
function failBatch(batch: Batch, failure: unknown): void {
  if (batch.ended?.kind !== "failed") batch.ended = { kind: "failed", failure };
}

/** Copy one file of the source's version to the copy's folder, with the media type and the hash the source holds. A source that no longer holds it ends the batch, and so does a write the store did not keep. */
async function copyFile(install: Install, upload: CopyUpload, path: string, batch: Batch): Promise<void> {
  const { from: source } = upload.plan;
  const from = fileKey(source.folder, source.number, path);
  const to = uploadKey(upload, path);
  if (!from.ok || !to.ok) throw new Error("a path of the copied version is no key of its upload");

  const read = await install.store.read(from.key);
  if (read.kind !== "found") {
    batch.ended ??= { kind: "missing" };

    return;
  }

  try {
    await install.store.write(to.key, { stream: read.body, size: read.info.size }, { contentType: read.info.contentType, sha256: read.info.sha256 });
  } catch (error) {
    failBatch(batch, error);
    batch.unkept += 1;
  }
}

/**
 * Count the writes of one call that the store did not keep against the day, and note it where they take the day past its limit: a host bills each.
 *
 * They are counted together, so a call whose six files all fail asks the database no more than a call whose one file fails.
 */
async function countUnkept(install: Install, writes: number): Promise<void> {
  const day = dayOf(install.now());
  await install.database.addStorageWrites(day, writes);
  const counted = await install.database.readStorageWrites(day);
  if (counted !== undefined && counted.writes > counted.most) await noteProblem(install, "writes_limit_reached");
}

/**
 * Copy files of the source's version to the copy's folder, a few at once and in no order.
 *
 * @returns `false` when the source no longer holds one of them, which leaves others uncopied
 * @throws {Error} the store or the database failed, once every file on its way has ended; a count that fails is the failure thrown
 */
async function copyFiles(install: Install, upload: CopyUpload, paths: readonly string[]): Promise<boolean> {
  const batch: Batch = { unkept: 0 };
  const copy = async (path: string): Promise<void> => {
    if (batch.ended !== undefined) return;

    await copyFile(install, upload, path, batch).catch((error: unknown) => failBatch(batch, error));
  };

  await pMap(paths, copy, { concurrency: COPIES_AT_ONCE });
  if (batch.unkept > 0) await countUnkept(install, batch.unkept);

  if (batch.ended?.kind === "failed") throw batch.ended.failure;

  return batch.ended === undefined;
}

/**
 * Reach the source, and the upload of its copy: a new one, or the one `upload` names.
 *
 * @param watching - whether the install runs the later rounds itself, so that a copy an earlier call began is found and not listed
 */
async function stageCopy(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof DUPLICATE_REQUEST> & { readonly site: string },
  watching: boolean,
): Promise<StagedNow | Watched | Refused<DuplicateCode>> {
  const reached = await reachSite(install, actor, request.site);
  if (!reached.ok) return reached;

  const { site, settings, signed } = reached;
  if (site.state === "trash") return refuse("in_trash");

  if (request.upload !== undefined) {
    if (request.name !== undefined) return refuse("bad_argument", "name");

    const resumed = await resumeCopy(install, actor, { site, reference: request.upload, now: signed.at, watching });

    return resumed.ok && resumed.missing !== null ? { ...resumed, fresh: false } : resumed;
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
async function advanceCopy(install: Install, actor: Actor, staged: StagedNow): Promise<Copying | Duplicated | Refused<DuplicateCode>> {
  const { upload, missing } = staged;
  const batch = missing.slice(0, copiesPerCall(upload.files));

  if (!(await copyFiles(install, upload, batch))) {
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

/** Find the pending upload of a copy by its id alone, as its owner would: one that is gone, given up, run out, or a site already is none. */
async function pendingCopy(install: Install, id: UploadId): Promise<{ readonly upload: CopyUpload; readonly owner: Actor; readonly manifest: readonly ManifestFile[] } | undefined> {
  const found = await install.database.getUpload(id);
  if (found === undefined) return undefined;

  const { upload } = found;
  const { plan } = upload;
  const owner: Actor = { scope: "publisher", holder: upload.owner };
  if (plan.kind !== "duplicate" || upload.state !== "pending" || !isWithinReach(upload, owner, install.now())) return undefined;

  return { upload: { ...upload, plan }, owner, manifest: found.manifest };
}

/**
 * Give up a copy whose round failed for good: its files are removed as an abandoned upload's are, and the failure is noted as the problem `copy_failed`. A copy that is gone or a site already is left as it is.
 *
 * @param failure - what the round threw
 * @throws {Error} the store or the database failed
 */
export async function failCopy(install: Install, id: UploadId, failure: unknown): Promise<void> {
  const pending = await pendingCopy(install, id);
  // A copy somebody gave up meanwhile, or that became a site, did not fail.
  if (pending === undefined || !(await install.database.abandonUpload(id))) return;

  await removeUploadFiles(install, pending.upload);
  await noteProblem(install, "copy_failed", failure);
}

/**
 * Run one round of a copy with nobody asking, as the copy's owner: the files it still lacks are found, the next ones copied, and a whole copy made a site.
 *
 * A copy that cannot be made is given up and noted as the problem `copy_failed`: its source stopped keeping the version, or the site was refused.
 *
 * @returns `more` while files are left or the site is still to make, and `done` once the copy is a site, was given up, ran out, or is gone
 * @throws {Error} the store or the database failed: the copy stays, and the round may be run again
 */
export async function continueCopy(install: Install, id: UploadId): Promise<"more" | "done"> {
  const pending = await pendingCopy(install, id);
  if (pending === undefined) return "done";

  const { upload, owner } = pending;
  const copied = await advanceCopy(install, owner, { ok: true, upload, missing: await missingFiles(install.store, upload, pending.manifest), fresh: false });
  if (copied.ok) return copied.site === null ? "more" : "done";

  // An upload that was given up meanwhile is no failure: somebody stopped the copy.
  if (copied.code === "not_found") return "done";

  // Files went missing between the listing and the finish, which leaves the upload pending: no later round would end it.
  if (copied.code === "missing_files") await discardUpload(install, upload);

  await noteProblem(install, "copy_failed");

  return "done";
}

/**
 * Give an unfinished copy up, as an upload is given up, and stop the job that copies it.
 *
 * @param reference - the copy's upload as sent
 * @returns what giving the upload up answers. Only an upload that was given up has its job stopped
 * @throws {Error} the database failed
 */
export async function cancelCopy(install: Install, actor: Actor, reference: string, jobs: Jobs): ReturnType<typeof abandonPublish> {
  const abandoned = await abandonPublish(install, actor, reference);
  const upload = parseUploadId(reference);
  if (abandoned.ok && upload !== undefined) await jobs.stop({ kind: "copy", upload });

  return abandoned;
}

/**
 * Make a new site that holds a copy of a site's live version, or ask after a copy an earlier call began: while `site` is `null` the caller calls again with `copy.upload`.
 * The copy is private whatever the source is, under a new id and a new folder, with no public name, at version 1, and its owner is the caller. Its name is the source's unless `name` is given.
 * It takes the source's search-engine and frame settings, and its title as `copyTitle` writes it; its expiry is a new site's, from `default_expires`. The install's limits bound it as they bound a publish.
 * @param request - `site` is a reference to the source; `name` goes with the first call alone, and `upload` with every later one
 * @param asking - the calls to the database the caller's request made before this action, to learn who asks: they count against the calls to the database one request may make
 * @param jobs - what a copy the first call left unfinished is started on. Where it runs by itself, a later call copies nothing and answers `copy.copied` as `null`; anywhere else each later call copies the next files
 * @returns the copy's progress, and the new site once every file is copied; `no_such_version` when the source stopped keeping the version meanwhile; `not_found` about `upload` for a copy that was given up. Every refusal left no site behind
 * @throws {Error} the store or the database failed, or the host did not take the job: a copy just begun is given up, and one named by `upload` stays. A `RangeError` before anything is read: `asking` leaves the action too few calls to the database
 */
export async function duplicateSite(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof DUPLICATE_REQUEST> & { readonly site: string },
  asking: number,
  jobs: Jobs,
): Promise<Copying | Duplicated | Refused<DuplicateCode>> {
  if (databaseCalls(asking) > DATABASE_BUDGET) throw new RangeError(`a request that made ${asking} calls to the database leaves a copy too few`);

  const staged = await stageCopy(install, actor, request, jobs.background);
  if (!staged.ok) return staged;

  const { upload } = staged;
  if (staged.missing === null) return { ok: true, before: null, site: null, copy: { upload: upload.id, copied: null, files: upload.files } };

  try {
    const copied = await advanceCopy(install, actor, staged);
    if (staged.fresh && copied.ok && copied.site === null) await jobs.start({ kind: "copy", upload: upload.id });

    return copied;
  } catch (error) {
    // An upload that became a site meanwhile is left as it is.
    if (staged.fresh) await discardUpload(install, staged.upload);

    throw error;
  }
}
