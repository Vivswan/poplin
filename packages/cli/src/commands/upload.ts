// The steps a publish, an import, and a duplicate share once an upload is begun: send every file, finish, and give the upload up when it cannot be finished.

import pMap, { pMapStop } from "p-map";
import pRetry from "p-retry";
import type * as v from "valibot";

import { ABANDONED_UPLOAD } from "../../../core/src/actions/abandon-publish";
import { PUBLISHED_SITE } from "../../../core/src/actions/finish-publish";
import { ISSUED_TICKETS } from "../../../core/src/actions/issue-tickets";
import { SHOWN_UPLOAD } from "../../../core/src/actions/show-upload";
import type { BEGUN_UPLOAD } from "../../../core/src/actions/uploads";
import type { Ticket } from "../../../core/src/storage/tickets";
import type { Called, Client, Failure } from "../client/client";
import { problem, problemOf } from "./problems";
import type { Io, Outcome, Session } from "./records";
import { TicketBook } from "./tickets";

/** How many files are on their way at once. */
const UPLOADS_AT_ONCE = 4;

/** How often one file is sent again before the upload is given up. A ticket takes the same bytes again, so sending twice is safe. */
const UPLOAD_RETRIES = 3;

/** The pause before a file is first sent again, in milliseconds. Each pause after it is twice as long, and each is stretched by a random share of up to its own length, so four lanes do not come back at one moment. */
const FIRST_RETRY_PAUSE_MS = 1000;

/** How often an upload is finished before it is given up: once, and twice more after sending the files the install said it lacks. */
const FINISH_ATTEMPTS = 3;

/** The first status that is the install's own failure rather than a refusal of what was sent. */
const SERVER_FAILURE = 500;

/** The status of an answer that says the install, or the zone in front of it, is asked too often. */
const TOO_MANY_REQUESTS = 429;

/** The status another place than the install refuses a ticket with: one that ran out, or that the place takes no more. */
const TICKET_REFUSED = 403;

/** What an upload says, once, when the place its tickets name refuses them and its files go through the install after all. */
const THROUGH_INSTALL = "the store did not take a file sent straight to it: sending the files through the install";

/** The code of an install whose database takes no more for the day. */
const ALLOWANCE_SPENT = "allowance_spent";

/** How often one call rests and is made again before its failure stands. */
const RESTS_PER_CALL = 6;

/** The first rest of a call whose answer names no wait, in seconds; each rest after it is twice as long. */
const FIRST_REST_SECONDS = 2;

/** The longest one rest, in seconds, whatever the answer asks for. */
const MAX_REST_SECONDS = 60;

/** How many milliseconds a second holds. */
const MS_PER_SECOND = 1000;

/** The answer to a finished upload. */
export type Published = v.InferOutput<typeof PUBLISHED_SITE>;

/** The answer to a begun upload: its id, and the tickets of its files when the install handed them out with it. */
export type Begun = v.InferOutput<typeof BEGUN_UPLOAD>;

/** What a wait needs of the machine's ends. */
type Resting = Pick<Io, "pause" | "status" | "err" | "terminal">;

/** What the lanes of one upload share: where every wait of it is waited out, the stop after which no file is sent again, and the tickets its files are sent by. */
interface Lanes {
  readonly pace: Pace;
  readonly stopped: AbortSignal;
  readonly tickets: TicketBook;
}

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

  /** Where every wait is waited out and told: on the progress line when there is one, else in a line on stderr. After its stop no file is sent again. */
  readonly io: Resting & Pick<Io, "stopped">;
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

/** Whether sending a file again after a pause may go better: the install failed or gave no answer, and the command goes on. An answer under 500, whoever gave it, and a database spent for the day answer the same again. */
function isWorthAnotherTry(failure: Failure): boolean {
  if (failure.kind === "stopped") return false;

  if (!("status" in failure)) return true;

  return failure.status >= SERVER_FAILURE && !(failure.kind === "refused" && failure.code === ALLOWANCE_SPENT);
}

/** Whether a file was refused for its ticket, by another place than the install: the install's own refusals are the API's, with a code. */
function isRefusedTicket(failure: Failure): boolean {
  return failure.kind === "unexpected" && failure.status === TICKET_REFUSED;
}

/** How long the pause before a file is sent again is, in milliseconds: a second, doubled with each sending before it, and stretched by a random share of up to its own length. */
function againPauseMs(sendings: number): number {
  return Math.round((1 + Math.random()) * FIRST_RETRY_PAUSE_MS * 2 ** (sendings - 1));
}

/** How long a call rests: as long as the answer asks, else two seconds doubled with each rest before it, and never over a minute. */
function restSeconds(failure: Failure, rests: number): number {
  const asked = "retryAfter" in failure ? failure.retryAfter : undefined;

  return Math.min(MAX_REST_SECONDS, Math.max(1, asked ?? FIRST_REST_SECONDS * 2 ** (rests - 1)));
}

/** A file that was not sent, as the error its next sending is decided on. */
class Unsent extends Error {
  readonly failure: Failure;

  constructor(failure: Failure) {
    super(failure.kind);
    this.failure = failure;
  }
}

/** The waits of one upload. Every call of it shares its rests, so one answer of "too many requests" holds all four lanes back and is told once; a stop during any wait ends the upload. */
class Pace {
  readonly #io: Resting;

  #rest: Promise<void> | undefined;

  #stopped: Failure | undefined;

  #told = false;

  constructor(io: Resting) {
    this.#io = io;
  }

  /** Wait on the command's one clock, and say why first: on the progress line where there is one, else in one line on stderr, so whatever runs the command in a pipe sees why it waits. */
  async #pause(ms: number, reason: string): Promise<void> {
    if (this.#io.terminal.progress) {
      this.#io.status(`${reason} (Ctrl-C stops)`);
      this.#told = true;
    } else {
      this.#io.err(reason);
    }

    if ((await this.#io.pause(ms)) === "interrupted") this.#stopped = { kind: "stopped" };
  }

  async #wait(failure: Failure, rests: number): Promise<void> {
    const seconds = restSeconds(failure, rests);

    try {
      await this.#pause(seconds * MS_PER_SECOND, `the install asks for a pause: going on in ${seconds} s`);
    } finally {
      this.#rest = undefined;
    }
  }

  /**
   * Wait out the rest that is on, if one is.
   *
   * @returns the failure of a command the person stopped during a rest, after which no call of the upload is made; nothing while the upload goes on
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

  /**
   * Pause before a file is sent again, and say which file and which sending of it comes.
   *
   * @param sendings - how often the file was sent so far
   * @returns whether the file is to be sent again: not once the person stopped the command, during this pause or before it
   */
  async again(path: string, sendings: number): Promise<boolean> {
    if (this.#stopped !== undefined) return false;

    const ms = againPauseMs(sendings);
    await this.#pause(ms, `the install did not take ${path}: sending it again in ${Math.round(ms / MS_PER_SECOND)} s, ${sendings + 1} of ${UPLOAD_RETRIES + 1}`);

    return this.#stopped === undefined;
  }

  /** Take the line of a wait off the terminal, where one was told. */
  clear(): void {
    if (this.#told) this.#io.status("");
  }
}

/**
 * Make a call, and make it again after each rest the install asks for, up to six rests.
 *
 * @param call - a call that is safe to make again
 * @returns the answer, or the failure that stands: any but "too many requests", that one once the rests ran out, or `stopped` once the person stopped the command
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

/**
 * Make one call that begins an upload or carries a copy on, and make it again after each rest the install asks for, as the calls of `sendUpload` are.
 *
 * @param call - a call that an answer of "too many requests" left undone, so that making it again begins nothing twice
 * @returns the answer, or the failure that stands, as `sendUpload` answers it; the line of a rest is off the terminal by then
 */
export async function callUnhurried<Done>(io: Resting, call: () => Promise<Called<Done>>): Promise<Called<Done>> {
  const pace = new Pace(io);

  try {
    return await unhurried(pace, call);
  } finally {
    pace.clear();
  }
}

/**
 * Send one file once, to the address and with the headers its ticket names. A file with no ticket yet has one asked for as it goes.
 * A file whose ticket is refused where it points goes again at once by another ticket, as the ticket book hands them out: a fresh one first, then one of the install's own route.
 */
async function sendOnce(client: Client, tickets: TicketBook, file: UploadFile): Promise<Called<undefined>> {
  for (;;) {
    const ticket = await tickets.of(file.path);
    if (!ticket.ok) return ticket;

    const body = await file.open();
    const sent = await client.send(ticket.value, body);
    if (sent.ok) return sent;

    // A request that broke off leaves the file open; a stream the request still holds refuses the cancel, and closes with the request.
    await body.cancel().catch(() => undefined);
    if (!isRefusedTicket(sent.failure) || !tickets.refused(ticket.value)) return sent;
  }
}

/** Send one file, and send it again after a pause while the install fails or gives no answer, up to three times more. The pause is the upload's own, on the command's clock: the library waits none. */
async function sendFile(client: Client, file: UploadFile, lanes: Lanes): Promise<Failure | undefined> {
  const attempt = async (): Promise<void> => {
    const sent = await unhurried(lanes.pace, () => sendOnce(client, lanes.tickets, file));

    if (!sent.ok) throw new Unsent(sent.failure);
  };

  try {
    await pRetry(attempt, {
      retries: UPLOAD_RETRIES,
      minTimeout: 0,
      signal: lanes.stopped,
      shouldRetry: ({ error, attemptNumber }) => error instanceof Unsent && isWorthAnotherTry(error.failure) && lanes.pace.again(file.path, attemptNumber),
    });
  } catch (error) {
    if (lanes.stopped.aborted) return { kind: "stopped" };

    if (error instanceof Unsent) return error.failure;

    throw error;
  }

  return undefined;
}

/** Send files, four at a time. The first file that cannot be sent stops the rest from starting; the answer is that file's failure, or `stopped` when the person stopped the command. */
async function sendFiles<File extends UploadFile>(client: Client, files: readonly File[], sending: Lanes & { readonly arrived: (file: File) => void }): Promise<Failure | undefined> {
  let failure: Failure | undefined;
  sending.tickets.expect(files.map((file) => file.path));

  const send = async (file: File): Promise<typeof pMapStop | undefined> => {
    if (failure !== undefined) return pMapStop;

    const failed = await sendFile(client, file, sending);

    if (failed !== undefined) {
      failure ??= failed;

      return undefined;
    }

    sending.tickets.arrived(file.path);
    // A file that arrives during a rest is told after it, so the line that says why nothing moves stays.
    await sending.pace.ready();
    sending.arrived(file);

    return undefined;
  };

  await pMap(files, send, { concurrency: UPLOADS_AT_ONCE });

  // A stop ends the upload whatever else a lane met, so it is the failure told.
  const stopped = await sending.pace.ready();
  if (stopped !== undefined || sending.stopped.aborted) return { kind: "stopped" };

  return failure;
}

function lacksFiles(finished: Called<Published>): boolean {
  return !finished.ok && finished.failure.kind === "refused" && finished.failure.code === "missing_files";
}

/**
 * The outcome of a command whose upload was not finished.
 *
 * @param aftermath - what became of the upload, in words; it goes before the failure's own hint
 * @returns the failure as the command's problem; a stop is one line, that the command was stopped and what became of the upload
 */
export function givenUp(failure: Failure, aftermath: string): Outcome {
  if (failure.kind === "stopped") return { ok: false, problem: problem("stopped", aftermath) };

  const said = problemOf(failure);
  const hint = said.hint === undefined ? aftermath : `${aftermath}; ${said.hint}`;

  return { ok: false, problem: { ...said, hint } };
}

/** Ask the install to give an upload up. The answer names the files of it that are not removed yet. */
export function abandonUpload(client: Client, upload: string): Promise<Called<v.InferOutput<typeof ABANDONED_UPLOAD>>> {
  return client.call(ABANDONED_UPLOAD, (api) => api.uploads[":upload"].$delete({ param: { upload } }));
}

function finishUpload(client: Client, upload: string): Promise<Called<Published>> {
  return client.call(PUBLISHED_SITE, (api) => api.uploads[":upload"].finish.$post({ param: { upload } }));
}

/**
 * Give an upload up after a failure. Once the person stopped the command, before this or during it, the upload is given up with calls that wait a few seconds at most.
 *
 * An install that answers that the upload is live finished it, though its answer was lost: the answer is then asked for once more.
 *
 * @returns what became of the upload; nothing here throws
 */
export async function giveUpUpload(session: Pick<Session, "client" | "afterStop">, upload: string): Promise<GivenUp> {
  const tried = await abandonUpload(session.client, upload);
  const stopped = !tried.ok && tried.failure.kind === "stopped";
  const client = stopped ? session.afterStop : session.client;
  const abandoned = stopped ? await abandonUpload(client, upload) : tried;
  if (abandoned.ok) return { kind: "abandoned" };

  const refusal = abandoned.failure.kind === "refused" ? abandoned.failure.code : undefined;
  if (refusal === "not_found") return { kind: "abandoned" };

  if (refusal !== "upload_finished") return { kind: "unknown" };

  const live = await finishUpload(client, upload);
  if (!live.ok) return { kind: "live" };

  return { kind: "published", answer: live.value };
}

/**
 * Send the files of a begun upload and finish it.
 *
 * Each file goes to the address its ticket names, with the ticket's headers. A file the begun upload answered no ticket for has one asked for, a hundred files a call, as the files go.
 * A ticket that another place than the install refuses is asked for anew once; refused again, the upload says so in one line and sends every file through the install.
 * Four files go at once; one the install fails on or does not answer is sent again after a pause it tells, up to three times more. While the install lacks files, it is asked which, sent those, and finished again, three times at most.
 * An answer of "too many requests" to any call here counts as none of those: the upload rests as long as the answer asks, says so, and makes the call again, up to six rests a call.
 * The answer after the sixth rest is the failure. Once the person stops the command, during a rest or a call, the failure is `stopped` and no call is made after it.
 * @returns the install's answer to the finish, or the first failure; the upload is then still there to be given up
 */
export async function sendUpload<File extends UploadFile>(client: Client, begun: Begun, files: readonly File[], on: Sending<File>): Promise<Called<Published>> {
  const upload = begun.upload.id;
  const pace = new Pace(on.io);
  const askTickets = async (paths: readonly string[], through: boolean): Promise<Called<readonly Ticket[]>> => {
    const json = through ? { paths: [...paths], through: "install" as const } : { paths: [...paths] };
    const asked = await unhurried(pace, () => client.call(ISSUED_TICKETS, (api) => api.uploads[":upload"].tickets.$post({ param: { upload }, json })));

    return asked.ok ? { ok: true, value: asked.value.tickets } : asked;
  };
  const sending = { arrived: on.arrived, pace, stopped: on.io.stopped, tickets: new TicketBook(begun.tickets, askTickets, () => on.io.err(THROUGH_INSTALL)) };
  const finish = (): Promise<Called<Published>> => unhurried(pace, () => finishUpload(client, upload));

  const unsent = await sendFiles(client, files, sending);
  if (unsent !== undefined) return { ok: false, failure: unsent };

  let finished = await finish();

  for (let attempt = 1; attempt < FINISH_ATTEMPTS && lacksFiles(finished); attempt += 1) {
    const shown = await unhurried(pace, () => client.call(SHOWN_UPLOAD, (api) => api.uploads[":upload"].$get({ param: { upload } })));
    if (!shown.ok) return shown;

    const lacking = new Set(shown.value.missing);
    const failure = await sendFiles(
      client,
      files.filter((file) => lacking.has(file.path)),
      sending,
    );
    if (failure !== undefined) return { ok: false, failure };

    finished = await finish();
  }

  return finished;
}
