// How a publisher sends the files of an upload: one ticket a file, which says where its bytes go and what goes with them. Whoever sends a file reads its ticket and builds no address of its own.

import * as v from "valibot";

import { MOMENT } from "../records/fields";
import type { ManifestFile, UploadId } from "../records/upload";
import type { ObjectKey } from "./storage";

/** The most tickets one request hands out. An upload of no more files gets them all as it begins. */
export const TICKETS_PER_CALL = 100;

/** One ticket as an answer holds it: the file's `path` as declared, the `url` its bytes go to by `method`, a whole address or a path of the install that answered, the `headers` sent with them, and the moment it `expires`. */
export const TICKET = v.object({ path: v.string(), url: v.string(), method: v.literal("PUT"), headers: v.record(v.string(), v.string()), expires: MOMENT });

/** One ticket: where one declared file is sent, and what goes with it. */
export type Ticket = Readonly<v.InferOutput<typeof TICKET>>;

/** One file a ticket is asked for: as its upload declared it, and the key its bytes are stored at. */
interface TicketedFile {
  readonly file: ManifestFile;
  readonly key: ObjectKey;
}

/** What hands out the tickets of an install's uploads. */
export interface Tickets {
  /**
   * Make one ticket for each file.
   *
   * @param upload - the upload the files are of, and the moment it stops taking files: no ticket lives past it
   * @returns the tickets, in the order of the files
   */
  issue(upload: { readonly id: UploadId; readonly expires: number }, files: readonly TicketedFile[]): Promise<readonly Ticket[]>;
}
