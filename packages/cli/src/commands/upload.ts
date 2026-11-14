// The steps a publish and an import share once an upload is begun: send every file, finish, and give the upload up when it cannot be finished.

import type { ROUTES } from "../../../core/src/api/routes";
import type { Called, Client, Failure } from "../client/client";

/** How many files are on their way at once. */
const UPLOADS_AT_ONCE = 4;

/** How often one file is sent before the upload is given up: once, and twice more. The route stores the same bytes again, so sending twice is safe. */
const UPLOAD_ATTEMPTS = 3;

/** How often an upload is finished before it is given up: once, and twice more after sending the files the install said it lacks. */
const FINISH_ATTEMPTS = 3;

/** The first status that is the install's own failure rather than a refusal of what was sent. */
const SERVER_FAILURE = 500;

/** The answer to a finished upload. */
export type Published = NonNullable<(typeof ROUTES)["finishPublish"]["types"]>["done"];

/** One file to send: the name the upload declared it under, its length, and what opens its bytes anew from the first. */
export interface UploadFile {
  readonly path: string;
  readonly size: number;
  open(): ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;
}

/**
 * What became of an upload that was given up.
 *
 * `abandoned` changed no site. `unknown` could not be given up, and runs out by itself. `live` was finished by the install though its answer was lost, and `published` is the same with the answer asked for again.
 */
export type GivenUp = { readonly kind: "abandoned" | "unknown" | "live" } | { readonly kind: "published"; readonly answer: Published };

/** Whether sending a file again may go better: the install failed or gave no answer, rather than refusing what was sent. */
function isWorthAnotherTry(failure: Failure): boolean {
  return failure.kind !== "refused" || failure.status >= SERVER_FAILURE;
}

async function sendFile(client: Client, upload: string, file: UploadFile): Promise<Failure | undefined> {
  let failure: Failure | undefined;

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    const body = await file.open();
    const sent = await client.call("uploadFile", { upload, path: file.path }, body, file.size);
    if (sent.ok) return undefined;

    // A request that broke off leaves the file open; a stream the request still holds refuses the cancel, and closes with the request.
    await body.cancel().catch(() => undefined);
    failure = sent.failure;

    if (!isWorthAnotherTry(failure)) return failure;
  }

  return failure;
}

/** Send files, four at a time. The first file that cannot be sent stops the rest from starting. */
async function sendFiles<File extends UploadFile>(client: Client, upload: string, files: readonly File[], arrived: (file: File) => void): Promise<Failure | undefined> {
  const waiting = [...files];
  let failure: Failure | undefined;

  const lane = async (): Promise<void> => {
    for (let file = waiting.shift(); file !== undefined && failure === undefined; file = waiting.shift()) {
      const failed = await sendFile(client, upload, file);

      if (failed === undefined) {
        arrived(file);
      } else {
        failure ??= failed;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, files.length) }, lane));

  return failure;
}

function lacksFiles(finished: Called<Published>): boolean {
  return !finished.ok && finished.failure.kind === "refused" && finished.failure.code === "missing_files";
}

/**
 * Give an upload up after a failure.
 *
 * An install that answers that the upload is live finished it, though its answer was lost: the answer is then asked for once more.
 *
 * @returns what became of the upload; nothing here throws
 */
export async function giveUpUpload(client: Client, upload: string): Promise<GivenUp> {
  const abandoned = await client.call("abandonPublish", { upload });
  if (abandoned.ok) return { kind: "abandoned" };

  const refusal = abandoned.failure.kind === "refused" ? abandoned.failure.code : undefined;
  if (refusal === "not_found") return { kind: "abandoned" };

  if (refusal !== "upload_finished") return { kind: "unknown" };

  const live = await client.call("finishPublish", { upload });
  if (!live.ok) return { kind: "live" };

  return { kind: "published", answer: live.value };
}

/**
 * Send the files of a begun upload and finish it.
 *
 * Four files are sent at once, each up to three times. While the install says it lacks files, it is asked which, sent those, and finished again, up to three finishes in all.
 *
 * @param arrived - called once for each file the install took
 * @returns the install's answer to the finish, or the first failure; the upload is then still there to be given up
 */
export async function sendUpload<File extends UploadFile>(client: Client, upload: string, files: readonly File[], arrived: (file: File) => void): Promise<Called<Published>> {
  const unsent = await sendFiles(client, upload, files, arrived);
  if (unsent !== undefined) return { ok: false, failure: unsent };

  let finished = await client.call("finishPublish", { upload });

  for (let attempt = 1; attempt < FINISH_ATTEMPTS && lacksFiles(finished); attempt += 1) {
    const shown = await client.call("showUpload", { upload });
    if (!shown.ok) return shown;

    const lacking = new Set(shown.value.missing);
    const failure = await sendFiles(
      client,
      upload,
      files.filter((file) => lacking.has(file.path)),
      arrived,
    );
    if (failure !== undefined) return { ok: false, failure };

    finished = await client.call("finishPublish", { upload });
  }

  return finished;
}
