// Show an upload: its state, and which of its files the store does not hold yet, so a client that broke off sends only those.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { parseUploadId } from "../records/upload";
import { type Install, type Refused, refuse } from "./records";
import { isWithinReach, missingFiles, UPLOAD_OBJECT, uploadObject } from "./uploads";

/** The most missing paths one answer names. */
const MAX_SHOWN = 1000;

/** What showing an upload answers: the upload, the first paths the store lacks, and whether more are missing. */
export const SHOWN_UPLOAD = v.object({ upload: UPLOAD_OBJECT, missing: v.pipe(v.array(v.string()), v.readonly()), more: v.boolean() });

/** An upload with the first paths the store lacks, in the manifest's order. `more` says that further paths are missing beyond those named. */
type Shown = { readonly ok: true } & Readonly<v.InferOutput<typeof SHOWN_UPLOAD>>;

/**
 * Read an upload and compare its manifest with what the store holds. Nothing changes.
 *
 * @param reference - the upload's id as sent
 * @returns the upload; a finished one misses nothing. `not_found` about `upload` for one that is gone, given up, run out, or another publisher's
 * @throws {Error} the store or the database failed
 */
export async function showUpload(install: Install, actor: Actor, reference: string): Promise<Shown | Refused<"bad_argument" | "not_found">> {
  const id = parseUploadId(reference);
  if (id === undefined) return refuse("bad_argument", "upload");

  const found = await install.database.getUpload(id);
  const upload = found?.upload;
  if (found === undefined || !isWithinReach(upload, actor, install.now())) return refuse("not_found", "upload");

  if (upload.state === "finished") return { ok: true, upload: uploadObject(upload), missing: [], more: false };

  const missing = await missingFiles(install.store, upload, found.manifest);

  return { ok: true, upload: uploadObject(upload), missing: missing.slice(0, MAX_SHOWN), more: missing.length > MAX_SHOWN };
}
