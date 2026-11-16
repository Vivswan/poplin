// Hand out the tickets of some files of a pending upload: where each is sent, and with what. Nothing is stored and nothing is written.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { type ManifestFile, parseUploadId } from "../records/upload";
import { TICKET, TICKETS_PER_CALL } from "../storage/tickets";
import { type Install, type Refused, refuse } from "./records";
import { isWithinReach, ticketsOf } from "./uploads";

/** What asks for tickets: the paths of 1 to 100 files, each as the upload's manifest names it and none twice. With `through` the sender asks for tickets of the install's own route, after whatever else its tickets named refused them. */
export const TICKETS_REQUEST = v.strictObject({
  paths: v.pipe(
    v.array(v.string()),
    v.minLength(1),
    v.maxLength(TICKETS_PER_CALL),
    v.check((paths) => new Set(paths).size === paths.length, "a path is named once"),
  ),
  through: v.optional(v.literal("install")),
});

/** What asking for tickets answers: one ticket a path, in the order asked. */
export const ISSUED_TICKETS = v.object({ tickets: v.array(TICKET) });

/**
 * Hand out the tickets of files a pending upload declared, for whoever may send them: the reach rules are those of `uploadFile`.
 *
 * A ticket is asked for again whenever one is lost or has run out: asking changes nothing, and two tickets of one file send the same bytes to the same place.
 *
 * @param request - the upload's id as sent, and the paths a `TICKETS_REQUEST` passed
 * @returns one ticket a path, in the order asked. `not_found` about `upload` for an upload that is gone, given up, run out, another publisher's, or the copy of a site, and about `path` when the manifest does not name one of the paths
 * @throws {Error} the database failed, or the install hands out no tickets
 */
export async function issueTickets(
  install: Install,
  actor: Actor,
  request: { readonly upload: string; readonly paths: readonly string[] },
): Promise<({ readonly ok: true } & v.InferOutput<typeof ISSUED_TICKETS>) | Refused<"bad_argument" | "not_found" | "upload_finished">> {
  const id = parseUploadId(request.upload);
  if (id === undefined) return refuse("bad_argument", "upload");

  const found = await install.database.getUploadFiles(id, request.paths);
  const upload = found?.upload;
  if (!isWithinReach(upload, actor, install.now())) return refuse("not_found", "upload");

  // A copy takes its files from its source alone.
  if (upload.plan.kind === "duplicate") return refuse("not_found", "upload");

  if (upload.state === "finished") return refuse("upload_finished", "upload");

  const files = (found?.files ?? []).filter((file): file is ManifestFile => file !== undefined);
  if (files.length !== request.paths.length) return refuse("not_found", "path");

  if (install.tickets === undefined) throw new Error("this install hands out no tickets");

  return { ok: true, tickets: [...(await ticketsOf(install.tickets, upload, files))] };
}
