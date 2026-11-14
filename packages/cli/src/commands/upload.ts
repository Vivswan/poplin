// The steps a publish, an import, and a duplicate share once an upload is begun: send every file, finish, and give the upload up when it cannot be finished.

import type { ROUTES } from "../../../core/src/api/routes";
import type { Called, Client, Failure } from "../client/client";
import { problemOf } from "./problems";
import type { Io, Outcome } from "./records";

/** How many files are on their way at once. */
const UPLOADS_AT_ONCE = 4;

/** How often one file is sent before the upload is given up: once, and twice more. The route stores the same bytes again, so sending twice is safe. */
const UPLOAD_ATTEMPTS = 3;

/** How often an upload is finished before it is given up: once, and twice more after sending the files the install said it lacks. */
const FINISH_ATTEMPTS = 3;

/** The first status that is the install's own failure rather than a refusal of what was sent. */
const SERVER_FAILURE = 500;

/** The status of an answer that says the install, or the zone in front of it, is asked too often. */
const TOO_MANY_REQUESTS = 429;

/** How often one call rests and is made again before its failure stands. */
const RESTS_PER_CALL = 6;

/** The first rest of a call whose answer names no wait, in seconds; each rest after it is twice as long. */
const FIRST_REST_SECONDS = 2;

/** The longest one rest, in seconds, whatever the answer asks for. */
const MAX_REST_SECONDS = 60;

/** How many milliseconds a second holds. */
const MS_PER_SECOND = 1000;

/** The answer to a finished upload. */
export type Published = NonNullable<(typeof ROUTES)["finishPublish"]["types"]>["done"];

/** What a rest needs of the machine's ends. */
type Resting = Pick<Io, "pause" | "status" | "terminal">;

/** One file to send: the name the upload declared it under, its length, and what opens its bytes anew from the first. */
export interface UploadFile {
  readonly path: string;
  readonly size: number;
  open(): ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;
}

/** What an upload is sent with besides its files. */
export interface Sending<File> {
  /** Called once for each file the install took. */
  readonly arrived: (file: File) => void;

  /** Where a rest is waited out, and shown on the progress line when there is one. */
  readonly io: Resting;
}

/**
 * What became of an upload that was given up.
 *
 * `abandoned` changed no site. `unknown` could not be given up, and runs out by itself. `live` was finished by the install though its answer was lost, and `published` is the same with the answer asked for again.
 */
export type GivenUp = { readonly kind: "abandoned" | "unknown" | "live" } | { readonly kind: "published"; readonly answer: Published };

/** Whether an answer says the install is asked too often, as JSON or as the page of whatever stands in front of it. */
function isAskedTooOften(failure: Failure): boolean {
  return "status" in failure && failure.status === TOO_MANY_REQUESTS;
}

/** Whether sending a file again at once may go better: the install failed or gave no answer, rather than refusing what was sent or asking for a rest. */
function isWorthAnotherTry(failure: Failure): boolean {
  if (isAskedTooOften(failure)) return false;

  return failure.kind !== "refused" || failure.status >= SERVER_FAILURE;
}

/** How long a call rests: as long as the answer asks, else two seconds doubled with each rest before it, and never over a minute. */
function restSeconds(failure: Failure, rests: number): number {
  const asked = "retryAfter" in failure ? failure.retryAfter : undefined;

  return Math.min(MAX_REST_SECONDS, Math.max(1, asked ?? FIRST_REST_SECONDS * 2 ** (rests - 1)));
}

/** The rests of one upload. Every call of it shares them, so one answer of "too many requests" holds all four lanes back and is told once. */
class Pace {
  readonly #io: Resting;

  #rest: Promise<void> | undefined;

  #stopped: Failure | undefined;

  constructor(io: Resting) {
    this.#io = io;
  }

  async #wait(failure: Failure, rests: number): Promise<void> {
    const seconds = restSeconds(failure, rests);
    if (this.#io.terminal.progress) this.#io.status(`the install asks for a pause: going on in ${seconds} s (Ctrl-C stops)`);

    try {
      if ((await this.#io.pause(seconds * MS_PER_SECOND)) === "interrupted") this.#stopped = failure;
    } finally {
      this.#rest = undefined;
    }
  }

  /**
   * Wait out the rest that is on, if one is.
   *
   * @returns the answer the person stopped the command over, after which no call of the upload is made; nothing while the upload goes on
   */
  async ready(): Promise<Failure | undefined> {
    await this.#rest;

    return this.#stopped;
  }

  /**
   * Rest after an answer of "too many requests": the rest that is on, or a new one.
   *
   * @param rests - how many rests the call has had, this one included
   */
  async rest(failure: Failure, rests: number): Promise<void> {
    if (this.#stopped === undefined) this.#rest ??= this.#wait(failure, rests);

    await this.#rest;
  }
}

/**
 * Make a call, and make it again after each rest the install asks for, up to six rests.
 *
 * @param call - a call that is safe to make again
 * @returns the answer, or the failure that stands: any but "too many requests", or that one once the rests ran out or the person stopped the command
 */
async function unhurried<Done>(pace: Pace, call: () => Promise<Called<Done>>): Promise<Called<Done>> {
  for (let rests = 1; ; rests += 1) {
    const stopped = await pace.ready();
    if (stopped !== undefined) return { ok: false, failure: stopped };

    const answered = await call();
    if (answered.ok || !isAskedTooOften(answered.failure) || rests > RESTS_PER_CALL) return answered;

    await pace.rest(answered.failure, rests);
  }
}

async function sendOnce(client: Client, upload: string, file: UploadFile): Promise<Called<unknown>> {
  const body = await file.open();
  const sent = await client.call("uploadFile", { upload, path: file.path }, body, file.size);

  // A request that broke off leaves the file open; a stream the request still holds refuses the cancel, and closes with the request.
  if (!sent.ok) await body.cancel().catch(() => undefined);

  return sent;
}

async function sendFile(client: Client, upload: string, file: UploadFile, pace: Pace): Promise<Failure | undefined> {
  let failure: Failure | undefined;

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt += 1) {
    const sent = await unhurried(pace, () => sendOnce(client, upload, file));
    if (sent.ok) return undefined;

    failure = sent.failure;

    if (!isWorthAnotherTry(failure)) return failure;
  }

  return failure;
}

/** Send files, four at a time. The first file that cannot be sent stops the rest from starting; the answer is that file's failure, or the one the person stopped the command over. */
async function sendFiles<File extends UploadFile>(client: Client, upload: string, files: readonly File[], sending: { readonly arrived: (file: File) => void; readonly pace: Pace }): Promise<Failure | undefined> {
  const waiting = [...files];
  let failure: Failure | undefined;

  const lane = async (): Promise<void> => {
    for (let file = waiting.shift(); file !== undefined && failure === undefined; file = waiting.shift()) {
      const failed = await sendFile(client, upload, file, sending.pace);

      if (failed === undefined) {
        // A file that arrives during a rest is told after it, so the line that says why nothing moves stays.
        await sending.pace.ready();
        sending.arrived(file);
      } else {
        failure ??= failed;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, files.length) }, lane));

  // A stop ends the upload whatever else a lane met, so it is the failure told.
  return (await sending.pace.ready()) ?? failure;
}

function lacksFiles(finished: Called<Published>): boolean {
  return !finished.ok && finished.failure.kind === "refused" && finished.failure.code === "missing_files";
}

/**
 * The outcome of a command whose upload was not finished.
 *
 * @param aftermath - what became of the upload, in words; it goes before the failure's own hint
 * @returns the failure as the command's problem
 */
export function givenUp(failure: Failure, aftermath: string): Outcome {
  const said = problemOf(failure);
  const hint = said.hint === undefined ? aftermath : `${aftermath}; ${said.hint}`;

  return { ok: false, problem: { ...said, hint } };
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
 * An answer of "too many requests" to any call here counts as none of those: the upload rests as long as the answer asks, says so on the progress line, and makes the call again, up to six rests a call.
 * The answer after the sixth rest is the failure, and so is the answer a rest followed when the person stops the command during it; no call is made after that.
 *
 * @returns the install's answer to the finish, or the first failure; the upload is then still there to be given up
 */
export async function sendUpload<File extends UploadFile>(client: Client, upload: string, files: readonly File[], on: Sending<File>): Promise<Called<Published>> {
  const sending = { arrived: on.arrived, pace: new Pace(on.io) };
  const finish = (): Promise<Called<Published>> => unhurried(sending.pace, () => client.call("finishPublish", { upload }));

  const unsent = await sendFiles(client, upload, files, sending);
  if (unsent !== undefined) return { ok: false, failure: unsent };

  let finished = await finish();

  for (let attempt = 1; attempt < FINISH_ATTEMPTS && lacksFiles(finished); attempt += 1) {
    const shown = await unhurried(sending.pace, () => client.call("showUpload", { upload }));
    if (!shown.ok) return shown;

    const lacking = new Set(shown.value.missing);
    const failure = await sendFiles(
      client,
      upload,
      files.filter((file) => lacking.has(file.path)),
      sending,
    );
    if (failure !== undefined) return { ok: false, failure };

    finished = await finish();
  }

  return finished;
}
