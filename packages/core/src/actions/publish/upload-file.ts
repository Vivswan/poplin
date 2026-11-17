// Store one file of a pending upload at its final key. The file is one of the manifest's, and its bytes are exactly the ones the manifest declared: as many, and of the same hash.

import * as v from "valibot";

import type { Actor } from "../../auth/scopes";
import { COUNT } from "../../records/fields";
import { type ManifestFile, parseUploadId, type Upload } from "../../records/upload";
import { dayOf } from "../../records/views";
import { HashMismatch, type ObjectInfo, type ObjectKey } from "../../storage/storage";
import { noteProblem } from "../install/problems";
import { type Install, type Refused, refuse } from "../records";
import { isKeptVersion, isWithinReach, uploadKey, uploadObject } from "./uploads";

/** What storing a file answers: its path as the manifest names it, and the bytes stored. */
export const STORED_FILE = v.object({ path: v.string(), size: COUNT });

/** The setting that bounds the day's writes to the store, which a refusal for it is about. */
const WRITES_SETTING = "max_storage_writes_per_day";

/** One file to store: the upload's id as sent, the file's path as the manifest names it, and its bytes, which are read once. */
interface FileRequest {
  readonly upload: string;
  readonly path: string;
  readonly body: ReadableStream<Uint8Array>;
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

/** Refuse a file without reading it. */
async function unread<Code extends string>(body: ReadableStream<Uint8Array>, code: Code, about: string): Promise<Refused<Code>> {
  await body.cancel();

  return refuse(code, about);
}

/**
 * Count a write the store did not keep, which a host bills as one it kept. Once the day has no room for it the upload is given up, so no file can be sent to fail without end.
 *
 * @returns whether the upload was given up
 */
async function countLostWrite(install: Install, upload: Upload): Promise<boolean> {
  const day = dayOf(install.now());
  await install.database.addStorageWrites(day, 1);
  const counted = await install.database.readStorageWrites(day);
  if (counted === undefined || counted.writes <= counted.most) return false;

  await install.database.abandonUpload(upload.id);
  await noteProblem(install, "writes_limit_reached");

  return true;
}

/** Whether an object is the file as it was declared: it holds a hash, and its hash, its size, and its type are the declared ones. An object that holds no hash is never the file, whatever the record names. */
function isDeclared(info: ObjectInfo, file: ManifestFile): boolean {
  return info.sha256 !== undefined && info.sha256 === file.sha256 && info.size === file.size && info.contentType === file.content_type;
}

/**
 * Write a file's bytes at its key, unless the store holds the file already: an upload's writes are counted once, when it begins, so a file sent again costs no second one.
 * The store holds the file already only when the object at the key has a hash of the store's own, and its hash, size, and type are the declared ones. Any other object is written over: it may be another file's bytes.
 *
 * @returns `stored`, or the refusal of bytes that are not the declared length or not of the declared hash, or of a write the day has no room to count
 * @throws {Error} the store failed, or the body broke off
 */
async function storeOnce(
  install: Install,
  placed: { readonly upload: Upload; readonly file: ManifestFile; readonly key: ObjectKey },
  body: ReadableStream<Uint8Array>,
): Promise<"stored" | Refused<"size_mismatch" | "hash_mismatch" | "allowance_spent">> {
  const { upload, file, key } = placed;
  const held = await install.store.head(key);
  if (held.kind === "found" && isDeclared(held.info, file)) {
    await body.cancel();

    return "stored";
  }

  const meter = metered(body);

  try {
    const stored = await install.store.write(key, { stream: meter.stream, size: file.size }, { contentType: file.content_type, sha256: file.sha256 });
    if (stored.size === file.size) return "stored";

    await install.store.delete(key);
  } catch (error) {
    if (await countLostWrite(install, upload)) return refuse("allowance_spent", WRITES_SETTING);

    if (meter.differsFrom(file.size)) return refuse("size_mismatch", file.path);

    if (error instanceof HashMismatch) return refuse("hash_mismatch", file.path);

    throw error;
  }

  return (await countLostWrite(install, upload)) ? refuse("allowance_spent", WRITES_SETTING) : refuse("size_mismatch", file.path);
}

/**
 * Store one file of a pending upload under `<folder>/v<number>/<path>`. An import names each file `v<number>/<path>`, which is its place under the folder.
 * A file the store already holds under the declared hash, size, and type is not stored again, so a file sent twice costs no second write. No visitor reads these keys before the upload is finished.
 *
 * @returns the path and the size stored. `not_found` about `upload` for an upload that is gone, given up, run out, another publisher's, or the copy of a site, and about `path` for a path the manifest does not name.
 * A file whose upload is given up while its bytes come in is answered as stored, and goes with the upload's other files at the sweep.
 * `size_mismatch` when the body is not the declared length, and `hash_mismatch` when its bytes are not of the declared hash: nothing of it is stored, and what the key held stays.
 * `allowance_spent` about `max_storage_writes_per_day` when a write failed and the day has no room to count it: the upload is given up
 * @throws {Error} the store or the database failed, or the body broke off
 */
export async function uploadFile(
  install: Install,
  actor: Actor,
  request: FileRequest,
): Promise<({ readonly ok: true } & Readonly<v.InferOutput<typeof STORED_FILE>>) | Refused<"bad_argument" | "not_found" | "upload_finished" | "size_mismatch" | "hash_mismatch" | "allowance_spent">> {
  const id = parseUploadId(request.upload);
  if (id === undefined) return unread(request.body, "bad_argument", "upload");

  const found = await install.database.getUploadFile(id, request.path);
  const upload = found?.upload;
  if (!isWithinReach(upload, actor, install.now())) return unread(request.body, "not_found", "upload");

  // A copy takes its files from its source alone, each with the type the source holds.
  if (upload.plan.kind === "duplicate") return unread(request.body, "not_found", "upload");

  const file = found?.file;
  if (upload.state === "finished") return unread(request.body, "upload_finished", "upload");

  if (file === undefined) return unread(request.body, "not_found", "path");

  const key = uploadKey(upload, file.path);
  if (!key.ok) throw new Error(`a path of the manifest is no key of its upload: ${key.refusal}`);

  const stored = await storeOnce(install, { upload, file, key: key.key }, request.body);
  if (stored !== "stored") return stored;

  // Inside the lifetime the record is still there. If the upload was given up meanwhile, the sweep removes this file with the rest.
  if (install.now() < uploadObject(upload).expires) return { ok: true, path: file.path, size: file.size };

  // The write outlived the lifetime, and the sweep may have removed the record: nothing would remove the file then, so it goes now.
  // A record that is gone may also be one that was finished and then swept: its files are a live version, and stay.
  const after = await install.database.getUploadFile(id, file.path);
  if (!isWithinReach(after?.upload, actor, install.now()) && !(await isKeptVersion(install, upload))) {
    await install.store.delete(key.key);

    return refuse("not_found", "upload");
  }

  return { ok: true, path: file.path, size: file.size };
}
