// Abandon a publish: the upload takes no more files and is never made live, and its files are removed.

import { type Actor, mayReachSite } from "../auth/scopes";
import { parseUploadId } from "../records/upload";
import { type Install, type Refused, refuse } from "./records";
import { discardUpload } from "./uploads";

/**
 * Give a pending upload up, inside its lifetime or past it. A site it was to update stays exactly as it is, and the version number it held is skipped.
 *
 * Asked again, it removes what is left of the files. The upload's record stays until the sweep, which removes the files once more and then the record.
 *
 * @param reference - the upload's id as sent
 * @returns `left` holds the upload's prefix when files may still sit under it, and is empty otherwise. `upload_finished` for an upload that is live, which no abandon undoes
 * @throws {Error} the database failed
 */
export async function abandonPublish(
  install: Install,
  actor: Actor,
  reference: string,
): Promise<{ readonly ok: true; readonly left: readonly string[] } | Refused<"bad_argument" | "not_found" | "upload_finished">> {
  const id = parseUploadId(reference);
  if (id === undefined) return refuse("bad_argument", "upload");

  const upload = (await install.database.getUploadFile(id, ""))?.upload;
  if (upload === undefined || !mayReachSite(actor, upload.owner)) return refuse("not_found", "upload");

  if (upload.state === "finished") return refuse("upload_finished", "upload");

  return { ok: true, left: await discardUpload(install, upload) };
}
