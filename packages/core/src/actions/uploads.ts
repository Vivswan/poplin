// What the steps of a staged publish or import share: the upload as a caller sees it, whether an actor may still touch one, where its files go, what the store holds of it, and giving it up.

import * as v from "valibot";

import { type Actor, mayReachSite } from "../auth/scopes";
import { COUNT, MOMENT, POSITIVE } from "../records/fields";
import { type ManifestFile, UPLOAD_ID, UPLOAD_STATE, type Upload } from "../records/upload";
import { contentsOf, type VersionContents } from "../records/version-contents";
import { MAX_LIST_LIMIT, type ObjectStore } from "../storage/storage";
import { fileKey, removeFiles, sitePrefix, versionPrefix } from "./files";
import type { Install } from "./records";
import { DAY_MS } from "./site-object";

/** How long an upload takes files and can be finished, from the moment it began. */
const UPLOAD_LIFETIME_MS = DAY_MS;

/** How long after its lifetime an upload is left alone, so that no request begun inside the lifetime is still writing when the sweep removes its files. */
const SWEEP_GRACE_MS = 3_600_000;

/** The list pages one step spends on removing an upload's files or a finished upload's dropped versions. */
const CLEANUP_PAGES = 10;

/** The most calls to the store one such removal makes: a listing and a removal a page. */
export const CLEANUP_CALLS = 2 * CLEANUP_PAGES;

/** The list pages spared beyond the count a manifest needs, for a store that hands out short pages. */
const SPARE_PAGES = 2;

/** How an import declares one file: `v`, the number of the version it belongs to, and its path in that version. */
const IMPORTED_PATH = /^v([1-9]\d{0,15})\/(.+)$/s;

/** A staged publish as an answer holds it. */
export const UPLOAD_OBJECT = v.object({ id: UPLOAD_ID, state: UPLOAD_STATE, version: POSITIVE, files: POSITIVE, bytes: COUNT, expires: MOMENT });

/** What beginning a publish or an import answers: the upload, whose id every later step names. */
export const BEGUN_UPLOAD = v.object({ upload: UPLOAD_OBJECT });

/** What says where an upload's files go. */
type Placed = Pick<Upload, "folder" | "number" | "plan">;

/**
 * A staged publish as a caller sees it. Times are milliseconds since the epoch.
 *
 * `version` is the number the files become once finished, `files` and `bytes` what the manifest declared. `expires` is when a pending upload stops taking files.
 * An import's `version` is 1 whatever versions its site keeps.
 */
type UploadObject = Readonly<v.InferOutput<typeof UPLOAD_OBJECT>>;

/** A publish or an import begun. */
export type BegunUpload = { readonly ok: true } & Readonly<v.InferOutput<typeof BEGUN_UPLOAD>>;

/** Build the upload object of a stored upload. */
export function uploadObject(upload: Upload): UploadObject {
  return { id: upload.id, state: upload.state, version: upload.number, files: upload.files, bytes: upload.bytes, expires: upload.created_at + UPLOAD_LIFETIME_MS };
}

/** The moment before which an upload began for the sweep to remove it at `now`. */
export function sweepableBefore(now: number): number {
  return now - UPLOAD_LIFETIME_MS - SWEEP_GRACE_MS;
}

/**
 * Decide whether an actor may still touch an upload.
 *
 * @returns `true` for an upload that is pending inside its lifetime, or finished, and that the actor began or an admin asks for. One that was given up, or ran out, is as gone as one that never was
 */
export function isWithinReach(upload: Upload | undefined, actor: Actor, now: number): upload is Upload {
  if (upload === undefined || !mayReachSite(actor, upload.owner)) return false;

  if (upload.state === "finished") return true;

  return upload.state === "pending" && now < upload.created_at + UPLOAD_LIFETIME_MS;
}

/**
 * The prefix every file of an upload sits under: one version of its folder, or the whole folder for an import, which fills every version of its site.
 *
 * @returns a prefix that ends in `/`
 */
function uploadPrefix(upload: Placed): string {
  return upload.plan.kind === "import" ? sitePrefix(upload.folder) : versionPrefix(upload.folder, upload.number);
}

/**
 * The key of one file an upload declares, built by `fileKey` alone.
 *
 * @param path - the path as the manifest names it: a path in the upload's version, or for an import `v<number>/<path>`
 * @returns the key, or why the path is none; an import's path that names no version is `empty`
 */
export function uploadKey(upload: Placed, path: string): ReturnType<typeof fileKey> {
  if (upload.plan.kind !== "import") return fileKey(upload.folder, upload.number, path);

  const [, number, rest] = IMPORTED_PATH.exec(path) ?? [];
  if (number === undefined || rest === undefined) return { ok: false, refusal: "empty" };

  return fileKey(upload.folder, Number(number), rest);
}

/**
 * Work out what each version an upload's files make holds, from the paths its manifest names.
 *
 * @returns what each version holds by its number: the upload's own for a publish or a copy, and every version its paths name for an import
 */
export function uploadContents(upload: Placed, manifest: readonly ManifestFile[]): ReadonlyMap<number, VersionContents> {
  if (upload.plan.kind !== "import") return new Map([[upload.number, contentsOf(manifest.map((file) => file.path))]]);

  const paths = new Map<number, string[]>();

  for (const file of manifest) {
    const [, number, rest] = IMPORTED_PATH.exec(file.path) ?? [];
    if (number === undefined || rest === undefined) continue;

    const held = paths.get(Number(number));
    if (held === undefined) paths.set(Number(number), [rest]);
    else held.push(rest);
  }

  return new Map([...paths].map(([number, held]) => [number, contentsOf(held)]));
}

/**
 * Compare what the store holds of an upload with its manifest, in one bounded listing: a page for every thousand files, and two to spare.
 *
 * @returns the paths of the manifest the store does not hold at their declared size, in the manifest's order; empty when every file is there
 * @throws {Error} the listing did not end inside its pages, or the upload's prefix holds a file the manifest does not name
 */
export async function missingFiles(store: ObjectStore, upload: Upload, manifest: readonly ManifestFile[]): Promise<readonly string[]> {
  const prefix = uploadPrefix(upload);
  const stored = new Map<string, number>();
  let page = await store.list({ prefix });

  for (let pages = Math.ceil(manifest.length / MAX_LIST_LIMIT) + SPARE_PAGES; ; pages -= 1) {
    for (const object of page.objects) stored.set(object.key, object.size);

    if (!page.more) break;

    if (pages <= 1) throw new Error(`the listing of ${prefix} did not end in the pages ${manifest.length} files need`);

    page = await store.list({ prefix, cursor: page.cursor });
  }

  // Every path of the manifest passed the key rules when the upload began, so its key is the prefix and the path as written.
  const missing = manifest.filter((file) => stored.get(`${prefix}${file.path}`) !== file.size);
  if (stored.size > manifest.length) throw new Error(`${prefix} holds a file its manifest does not name`);

  return missing.map((file) => file.path);
}

/**
 * Remove the files of the versions a finished upload dropped, as far as one bounded removal goes, and record the versions still to go.
 *
 * @param dropped - the versions as the upload's record names them
 * @returns the prefixes that may still hold files; empty when all went
 */
export async function removeDropped(install: Install, upload: Pick<Upload, "id" | "folder">, dropped: readonly number[]): Promise<readonly string[]> {
  if (dropped.length === 0) return [];

  const numbers = new Map(dropped.map((number) => [versionPrefix(upload.folder, number), number]));
  const left = await removeFiles(install.store, [...numbers.keys()], CLEANUP_PAGES);
  const kept = dropped.filter((number) => left.includes(versionPrefix(upload.folder, number)));
  if (kept.length < dropped.length) await install.database.setUploadDropped(upload.id, kept);

  return left;
}

/**
 * Decide whether the files of an upload are kept by a site, whatever became of the upload's record: a version its site keeps, or for an import the site in its folder.
 *
 * @param upload - the upload as it was read while it was pending
 */
export async function isKeptVersion(install: Install, upload: Placed): Promise<boolean> {
  const site = await install.database.getSiteByFolder(upload.folder);
  if (upload.plan.kind === "import") return site !== undefined;

  return site?.versions.some((version) => version.number === upload.number) ?? false;
}

/**
 * Remove the files of an upload that will never be live, as far as one bounded removal goes.
 *
 * @param upload - an upload that is given up
 * @returns the upload's prefix when files may still sit under it, and nothing otherwise
 */
export function removeUploadFiles(install: Install, upload: Placed): Promise<readonly string[]> {
  return removeFiles(install.store, [uploadPrefix(upload)], CLEANUP_PAGES);
}

/**
 * Give an upload up and remove its files, as far as one bounded removal goes. Its record stays until the sweep, which removes the files again and then the record.
 *
 * An upload that another request finished in the meantime is left as it is: its files are a live version.
 *
 * @param upload - the upload as it was read, pending or abandoned
 * @returns the upload's prefix when files may still sit under it, and nothing otherwise
 */
export async function discardUpload(install: Install, upload: Upload): Promise<readonly string[]> {
  const givenUp = upload.state === "abandoned" || (await install.database.abandonUpload(upload.id));

  if (!givenUp) {
    const now = await install.database.getUploadFile(upload.id, "");
    if (now?.upload.state !== "abandoned") return [];
  }

  return removeUploadFiles(install, upload);
}
