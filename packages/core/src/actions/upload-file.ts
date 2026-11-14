// Store one file of a pending upload at its final key. The file is one of the manifest's, and its bytes are exactly as many as the manifest declared.

import type { Actor } from "../auth/scopes";
import { parseUploadId } from "../records/upload";
import { type Install, type Refused, refuse } from "./records";
import { isKeptVersion, isWithinReach, uploadKey } from "./uploads";

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
 * Store one file of a pending upload under `<folder>/v<number>/<path>`, replacing what an earlier request stored there.
 * An import names each file `v<number>/<path>`, which is its place under the folder.
 *
 * The same file sent again is stored again. A site is live at these keys only once the upload is finished, so no visitor reads them before.
 *
 * @returns the path and the size stored. `not_found` about `upload` for an upload that is gone, given up, run out, another publisher's, or the copy of a site, and about `path` for a path the manifest does not name.
 * `size_mismatch` when the body is not the declared length: nothing of it is stored, and what the key held stays
 * @throws {Error} the store or the database failed, or the body broke off
 */
export async function uploadFile(
  install: Install,
  actor: Actor,
  request: FileRequest,
): Promise<{ readonly ok: true; readonly path: string; readonly size: number } | Refused<"bad_argument" | "not_found" | "upload_finished" | "size_mismatch">> {
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
  if (!key.ok) throw new Error(`${JSON.stringify(file.path)} is no key of upload ${upload.id}: ${key.refusal}`);

  const meter = metered(request.body);

  try {
    const stored = await install.store.write(key.key, { stream: meter.stream, size: file.size }, { contentType: file.content_type });
    if (stored.size !== file.size) {
      await install.store.delete(key.key);

      return refuse("size_mismatch", file.path);
    }
  } catch (error) {
    if (meter.differsFrom(file.size)) return refuse("size_mismatch", file.path);

    throw error;
  }

  // The write may have outlived the upload: it ran out, was given up, or was swept while the bytes came in. Nothing would ever remove the file then, so it goes now.
  // A record that is gone may also be one that was finished and then swept: its files are a live version, and stay.
  const after = await install.database.getUploadFile(id, file.path);
  if (!isWithinReach(after?.upload, actor, install.now()) && !(await isKeptVersion(install, upload))) {
    await install.store.delete(key.key);

    return refuse("not_found", "upload");
  }

  return { ok: true, path: file.path, size: file.size };
}
