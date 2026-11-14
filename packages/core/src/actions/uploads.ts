// What the steps of a staged publish share: the upload as a caller sees it, whether an actor may still touch one, what the store holds of it, and giving it up.

import { type Actor, mayReachSite } from "../auth/scopes";
import type { ManifestFile, Upload } from "../records/upload";
import { MAX_LIST_LIMIT, type ObjectStore } from "../storage/storage";
import { fileKey, removeFiles, versionPrefix } from "./files";
import type { Install } from "./records";
import { DAY_MS } from "./site-object";

/** How long an upload takes files and can be finished, from the moment it began. */
const UPLOAD_LIFETIME_MS = DAY_MS;

/** How long after its lifetime an upload is left alone, so that no request begun inside the lifetime is still writing when the sweep removes its files. */
const SWEEP_GRACE_MS = 3_600_000;

/** The list pages one step spends on removing an upload's files or a finished upload's dropped versions: 20 store calls. */
export const CLEANUP_PAGES = 10;

/** The list pages spared beyond the count a manifest needs, for a store that hands out short pages. */
const SPARE_PAGES = 2;

/**
 * A staged publish as a caller sees it. Times are milliseconds since the epoch.
 *
 * `version` is the number the files become once finished, `files` and `bytes` what the manifest declared. `expires` is when a pending upload stops taking files.
 */
export interface UploadObject {
  readonly id: Upload["id"];
  readonly state: Upload["state"];
  readonly version: number;
  readonly files: number;
  readonly bytes: number;
  readonly expires: number;
}

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
 * Compare what the store holds of an upload with its manifest, in one bounded listing: a page for every thousand files, and two to spare.
 *
 * @returns the paths of the manifest the store does not hold at their declared size, in the manifest's order; empty when every file is there
 * @throws {Error} the listing did not end inside its pages, or the version holds a file the manifest does not name
 */
export async function missingFiles(store: ObjectStore, upload: Upload, manifest: readonly ManifestFile[]): Promise<readonly string[]> {
  const prefix = versionPrefix(upload.folder, upload.number);
  const stored = new Map<string, number>();
  let page = await store.list({ prefix });

  for (let pages = Math.ceil(manifest.length / MAX_LIST_LIMIT) + SPARE_PAGES; ; pages -= 1) {
    for (const object of page.objects) stored.set(object.key, object.size);

    if (!page.more) break;

    if (pages <= 1) throw new Error(`the listing of ${prefix} did not end in the pages ${manifest.length} files need`);

    page = await store.list({ prefix, cursor: page.cursor });
  }

  const missing = manifest.filter((file) => {
    const key = fileKey(upload.folder, upload.number, file.path);

    return !key.ok || stored.get(key.key) !== file.size;
  });
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
 * Decide whether the files of an upload are a version its site keeps, whatever became of the upload's record.
 *
 * @param upload - the upload as it was read while it was pending
 */
export async function isKeptVersion(install: Install, upload: Pick<Upload, "folder" | "number">): Promise<boolean> {
  const site = await install.database.getSiteByFolder(upload.folder);

  return site?.versions.some((version) => version.number === upload.number) ?? false;
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

  return removeFiles(install.store, [versionPrefix(upload.folder, upload.number)], CLEANUP_PAGES);
}
