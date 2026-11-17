// Abandon a publish: the upload takes no more files and is never made live, and its files are removed.

import * as v from "valibot";

import { type Actor, mayReachSite } from "../../auth/scopes";
import { parseUploadId } from "../../records/upload";
import { type Install, type Refused, refuse } from "../records";
import { removeUploadFiles } from "./uploads";

/** What giving an upload up answers: the prefix files may still sit under, or nothing. */
export const ABANDONED_UPLOAD = v.object({ left: v.pipe(v.array(v.string()), v.readonly()) });

/**
 * Give a pending upload up, inside its lifetime or past it. A site it was to update stays exactly as it is, and the version number it held is skipped.
 *
 * Asked again, it removes what is left of the files. The upload's record stays until the sweep, which removes the files once more and then the record.
 *
 * @param reference - the upload's id as sent
 * @returns `left` holds the upload's prefix when files may still sit under it, and is empty otherwise. `upload_finished` for an upload that is live, or that became live while this call was at work, which no abandon undoes
 * @throws {Error} the database failed
 */
export async function abandonPublish(
  install: Install,
  actor: Actor,
  reference: string,
): Promise<({ readonly ok: true } & Readonly<v.InferOutput<typeof ABANDONED_UPLOAD>>) | Refused<"bad_argument" | "not_found" | "upload_finished">> {
  const id = parseUploadId(reference);
  if (id === undefined) return refuse("bad_argument", "upload");

  const upload = (await install.database.getUploadFile(id, ""))?.upload;
  if (upload === undefined || !mayReachSite(actor, upload.owner)) return refuse("not_found", "upload");

  if (upload.state === "finished") return refuse("upload_finished", "upload");

  // Whoever finishes the upload may win over this call: a copy's job does, with nobody asking. The upload is then live, and nothing was given up.
  if (upload.state === "pending" && !(await install.database.abandonUpload(id)) && (await install.database.getUploadFile(id, ""))?.upload.state === "finished") return refuse("upload_finished", "upload");

  return { ok: true, left: await removeUploadFiles(install, upload) };
}
