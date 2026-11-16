// The client of the HTTP API: its requests are typed from the routes the app declares, and each is answered with a checked value or a failure in words. Nothing it does throws.

import { hc } from "hono/client";
import pRetry from "p-retry";
import * as v from "valibot";

import type { Api } from "../../../app/src/api/api";
import { mediaTypeOf } from "../../../core/src/api/media-type";
import { API_ERROR, type ApiError, STORED_TYPE_HEADER } from "../../../core/src/api/routes";
import { textUpTo } from "../../../core/src/api/text-up-to";
import type { Ticket } from "../../../core/src/storage/tickets";

/** How long a call that carries JSON, or nothing, may take: 30 seconds. */
const CALL_TIMEOUT_MS = 30_000;

/** How long the upload or the download of one file, or a call the install answers only once its work is done, may take: 10 minutes. */
const FILE_TIMEOUT_MS = 600_000;

/** The most bytes of an answer that are read: 16 MB, far above a page of a hundred sites. */
const MAX_ANSWER_BYTES = 16_000_000;

/** A count of bytes as a header writes it. */
const BYTE_COUNT = /^\d{1,15}$/;

/** How long an answer asks its caller to wait, as `Retry-After` writes whole seconds. */
const WAIT_SECONDS = /^\d{1,9}$/;

/** The most characters kept of the line an answer in plain text says. */
const MAX_SAID_LENGTH = 200;

/** A control character, which no kept line holds: the line is printed on a terminal. */
const CONTROL = /\p{Cc}/gu;

/** The media type of an answer whose first line is kept. */
const PLAIN_TEXT = "text/plain";

/** The status of a done answer, and the first of the 200s. */
const OK = 200;

/** The first status past the 200s. */
const REDIRECT = 300;

/** The codes of a connection the far end cut before any answer. Bun names the first on the error its `fetch` throws, and Node either one on that error's `cause`. */
const CUT_CODES: ReadonlySet<unknown> = new Set(["ECONNRESET", "UND_ERR_SOCKET"]);

/** The line told when a request is sent once more. */
const SENT_AGAIN = "the connection to the install was cut before any answer: sending the request again";

/** The codes of a request that never left this computer: no name found, or no connection opened. Bun names `ENOTFOUND` and `ConnectionRefused` on the error its `fetch` throws, Node `ENOTFOUND`, `EAI_AGAIN`, and `ECONNREFUSED` on that error's `cause`. */
const NEVER_LEFT_CODES: ReadonlySet<unknown> = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ConnectionRefused"]);

/** How long a request that never left waits before it is tried once more, in milliseconds: a name a moment old is not known everywhere at once. */
const NEVER_LEFT_PAUSE_MS = 1000;

/** The line told when a request that never left is tried once more. */
const TRIED_AGAIN = `no connection to the install: trying once more in ${NEVER_LEFT_PAUSE_MS / 1000} s`;

/** The status another place than the install answers a file it stored nothing of, because its ticket writes once and something is there, or because the bytes are not the ones the ticket binds. */
const NOT_WRITTEN = 412;

/** The platform's `fetch`, or a stand-in for it. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Why a call got no answer to use.
 *
 * `refused` is the API's own refusal, with its code. `unreachable` is a request that never got an answer, `timeout` one that took too long.
 * `stopped` is a call the person stopped the command before or during: the install may have had the request all the same.
 * `not-json` is an answer that is no JSON, such as a proxy's error page, and `unexpected` one that is JSON of a form the API never sends, or a redirect.
 * `said` is the first line of a `not-json` answer in plain text: an install that cannot start says why in one.
 *
 * `retryAfter` is how many seconds an answer asked its caller to wait, when its `Retry-After` header names whole seconds.
 */
export type Failure =
  | { readonly kind: "refused"; readonly status: number; readonly code: string; readonly message: string; readonly about?: string; readonly retryAfter?: number }
  | { readonly kind: "unreachable" }
  | { readonly kind: "stopped" }
  | { readonly kind: "timeout"; readonly seconds: number }
  | { readonly kind: "not-json"; readonly status: number; readonly said?: string; readonly retryAfter?: number }
  | { readonly kind: "unexpected"; readonly status: number; readonly retryAfter?: number };

/** What a call answers: the route's answer, or why there is none. */
export type Called<Done> = { readonly ok: true; readonly value: Done } | { readonly ok: false; readonly failure: Failure };

/** One stored file as the install sends it: its bytes, which are read once, and the media type it is served with. `size` is their count when the answer names it in `Content-Length`: a server may send the bytes without one. */
interface Download {
  readonly body: ReadableStream<Uint8Array>;
  readonly size?: number;
  readonly contentType: string;
}

/** What a client is made of. */
interface ClientOptions {
  /** The origin of the install, such as `https://poplin.example.com`. */
  readonly server: string;

  /** The token every request presents. It goes into the `Authorization` header and nowhere else. A computer that is logging in has none, and sends no such header. */
  readonly token?: string;

  /** What sends the requests. */
  readonly fetch: Fetch;

  /** How long one call may take, in milliseconds, in place of the two defaults. */
  readonly timeoutMs?: number;

  /** Told the one line that says a request is sent once more, each time one is. */
  readonly told?: (line: string) => void;

  /** Waits so many milliseconds before a request that never left is tried once more. A client without it tries at once. */
  readonly pause?: (ms: number) => Promise<unknown>;

  /** What aborts when the person stops the command: every call then fails as `stopped`, the ones on their way included. A client without it takes no stop. */
  readonly stopped?: AbortSignal;
}

/** Every route of an install as a request to send, typed by what the route takes. A value that goes into a path is put there as it is given, so it is one a parser or a checked answer made. */
type ApiCalls = ReturnType<typeof hc<Api>>["api"];

/** What is read of an answer here: its status, its headers, and its body. */
type Raw = Pick<Response, "status" | "headers" | "body">;

/** The answer of a route whose done request answers JSON of one form. */
type Answering<Done> = Promise<Raw & { json(): Promise<Done | ApiError> }>;

/**
 * A client of one install. None of its three calls throws.
 *
 * `call` sends the one request `ask` makes of the routes, and answers the route's answer, checked against `form`, or the failure. A form the route's answer does not fit does not compile.
 *
 * `send` sends the bytes of one file of an upload to the address its ticket names, by the ticket's method and with its headers. A ticket that names a path is sent to that path of the install.
 * The token goes with them only to the install's own origin. Any answer in the 200s is the file taken; any other answer of the install is read as `call` reads a refusal.
 * Another place's answer is never read: 412 is a file the place holds already or would not take, which the finish of the upload tells apart, and any other status is `unexpected` with that status, of which 403 is a ticket the place takes no more.
 * `download` asks for one stored file of one version of a site. Its bytes are not read here: the caller reads the stream to its end or cancels it, and a read that breaks off throws there.
 */
export interface Client {
  readonly call: <Form extends v.GenericSchema>(form: Form, ask: (api: ApiCalls) => Answering<v.InferOutput<Form>>, how?: "repeatable" | "long") => Promise<Called<v.InferOutput<Form>>>;
  readonly send: (ticket: Ticket, body: ReadableStream<Uint8Array> | Uint8Array) => Promise<Called<undefined>>;
  readonly download: (file: { readonly site: string; readonly version: number; readonly path: string }) => Promise<Called<Download>>;
}

/** A request whose connection was cut, as the error its second sending is decided on. It holds nothing of what the `fetch` threw. */
class Cut extends Error {}

/** A request that never left this computer, as the error its second sending is decided on. It holds nothing of what the `fetch` threw. */
class NeverLeft extends Error {}

function failed(failure: Failure): { readonly ok: false; readonly failure: Failure } {
  return { ok: false, failure };
}

/** The text of an answer, read up to the cap; `undefined` for one that is longer. */
async function readText(response: Raw): Promise<string | undefined> {
  if (response.body === null) return "";

  return textUpTo(response.body, MAX_ANSWER_BYTES);
}

function parseJson(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** The wait an answer asks for, under the key a failure keeps it; nothing for an answer that names no whole seconds. */
function waitOf(response: Raw): { readonly retryAfter?: number } {
  const header = response.headers.get("Retry-After") ?? "";

  return WAIT_SECONDS.test(header) ? { retryAfter: Number(header) } : {};
}

/** The first line of an answer in plain text, under the key a failure keeps it; nothing for an answer of any other type, or one whose first line is empty. */
function saidOf(response: Raw, text: string | undefined): { readonly said?: string } {
  if (text === undefined || mediaTypeOf(response.headers.get("Content-Type")) !== PLAIN_TEXT) return {};

  const [line = ""] = text.split("\n");
  const said = line.replace(CONTROL, "").trim().slice(0, MAX_SAID_LENGTH);

  return said === "" ? {} : { said };
}

/** Read an answer that is JSON into the value a done answer holds, or into the failure any other answer is. */
async function readJson(response: Raw): Promise<Called<unknown>> {
  const { status } = response;
  const wait = waitOf(response);
  const text = await readText(response);
  const parsed = text === undefined ? undefined : parseJson(text);
  if (parsed === undefined) return failed({ kind: "not-json", status, ...saidOf(response, text), ...wait });

  if (status === OK) return { ok: true, value: parsed.value };

  const refusal = v.safeParse(API_ERROR, parsed.value);
  if (!refusal.success || status < 400) return failed({ kind: "unexpected", status, ...wait });

  const { code, message, about } = refusal.output.error;
  if (about === undefined) return failed({ kind: "refused", status, code, message, ...wait });

  return failed({ kind: "refused", status, code, message, about, ...wait });
}

/** Read an answer into the value of its form, or a failure. An answer of another form is a failure, so no command reads a key that is not there. */
async function readAnswer<Form extends v.GenericSchema>(form: Form, response: Raw): Promise<Called<v.InferOutput<Form>>> {
  const read = await readJson(response);
  if (!read.ok) return read;

  if (!v.is(form, read.value)) return failed({ kind: "unexpected", status: response.status });

  return { ok: true, value: read.value };
}

/** Read the answer to a file sent by its ticket: taken on any status in the 200s, whatever the body, else the failure the answer is. */
async function readSent(response: Raw): Promise<Called<undefined>> {
  const { status } = response;

  if (status >= OK && status < REDIRECT) {
    await response.body?.cancel().catch(() => undefined);

    return { ok: true, value: undefined };
  }

  const read = await readJson(response);

  return read.ok ? failed({ kind: "unexpected", status }) : read;
}

/** The code an error names, or the one its cause does. Nothing else of it is read: its text may quote the request. */
function codeOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;

  return "code" in error ? error.code : codeOf("cause" in error ? error.cause : undefined);
}

/**
 * Read the answer of another place than the install to a file sent by its ticket, by its status alone: what the place writes is its own, and is not passed on.
 *
 * A 412 is taken as the file sent: the place tells a file it holds already from bytes it would not take by no status, and the install says which as the upload is finished.
 */
async function readElsewhere(response: Raw): Promise<Called<undefined>> {
  const { status } = response;
  await response.body?.cancel().catch(() => undefined);

  if ((status >= OK && status < REDIRECT) || status === NOT_WRITTEN) return { ok: true, value: undefined };

  return failed({ kind: "unexpected", status, ...waitOf(response) });
}

/** The media type a header holds percent-encoded; `undefined` for a header that is absent or is no such text. */
function storedType(header: string | null): string | undefined {
  if (header === null) return undefined;

  try {
    return decodeURIComponent(header);
  } catch {
    return undefined;
  }
}

/** Read the answer to a download: the stream with what the headers say of it, or the refusal a JSON body holds. A done answer without its type, or with a length that is no count, is none. */
async function readDownload(response: Raw): Promise<Called<Download>> {
  const { status } = response;

  if (status !== 200) {
    const read = await readJson(response);

    return read.ok ? failed({ kind: "unexpected", status }) : read;
  }

  const length = response.headers.get("Content-Length");
  const contentType = storedType(response.headers.get(STORED_TYPE_HEADER));

  if ((length !== null && !BYTE_COUNT.test(length)) || contentType === undefined) {
    await response.body?.cancel().catch(() => undefined);

    return failed({ kind: "unexpected", status });
  }

  return { ok: true, value: { body: response.body ?? new Blob([]).stream(), contentType, ...(length === null ? {} : { size: Number(length) }) } };
}

/**
 * Build the client of one install.
 *
 * A call waits 30 seconds for its answer, and the upload of one file 10 minutes. A download has 10 minutes from its request to its last byte. No redirect is followed, so the token goes to the install's origin alone.
 * A request that never left this computer, its name not found or no connection opened, is tried once more after a second, whatever it asks: nothing of it was sent. A file is not: its upload sends it again by its own count.
 * A GET, or a call marked `repeatable`, whose connection was cut before any answer is sent once more. Each is told, and no request is sent more than twice. No other request that left is sent twice.
 */
export function createClient(options: ClientOptions): Client {
  const headers = { Accept: "application/json", ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }) };

  const twice = (signal: AbortSignal, repeatable: boolean, send: (fresh: RequestInit) => Promise<Response>): Promise<Response> => {
    const attempt = async (sending: number): Promise<Response> => {
      try {
        // Bun sends a request that asks for no kept connection on a new one; Node drops the cut one by itself.
        return await send(sending === 1 ? {} : { keepalive: false });
      } catch (error) {
        const code = codeOf(error);
        if (NEVER_LEFT_CODES.has(code)) throw new NeverLeft();

        throw CUT_CODES.has(code) ? new Cut() : error;
      }
    };
    const again = async ({ error }: { readonly error: Error }): Promise<boolean> => {
      if (error instanceof NeverLeft) {
        options.told?.(TRIED_AGAIN);
        // The pause is the command's own: the library waits none.
        await options.pause?.(NEVER_LEFT_PAUSE_MS);

        return true;
      }

      if (!(error instanceof Cut) || !repeatable) return false;

      options.told?.(SENT_AGAIN);

      return true;
    };

    return pRetry(attempt, { retries: 1, minTimeout: 0, signal, shouldRetry: again });
  };

  const ask = async <Done>(
    patienceMs: number,
    send: (api: ApiCalls, signal: AbortSignal) => Promise<Raw>,
    read: (response: Raw) => Promise<Called<Done>>,
    again?: "repeatable",
  ): Promise<Called<Done>> => {
    const timeoutMs = options.timeoutMs ?? patienceMs;
    const tooLong = AbortSignal.timeout(timeoutMs);
    const signal = options.stopped === undefined ? tooLong : AbortSignal.any([tooLong, options.stopped]);
    const once = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => options.fetch(String(input), { ...init, redirect: "manual", signal });
    const safely = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => twice(signal, again !== undefined || init?.method === "GET", (fresh) => once(input, { ...init, ...fresh }));
    const routes = hc<Api>(options.server, { headers, fetch: safely });

    try {
      return await read(await send(routes.api, signal));
    } catch {
      if (options.stopped?.aborted === true) return failed({ kind: "stopped" });

      if (tooLong.aborted) return failed({ kind: "timeout", seconds: Math.round(timeoutMs / 1000) });

      // What a `fetch` throws is dropped unread: it may quote the request, and the request holds the token.
      return failed({ kind: "unreachable" });
    }
  };

  const call: Client["call"] = (form, send, how) => ask(how === "long" ? FILE_TIMEOUT_MS : CALL_TIMEOUT_MS, send, (response) => readAnswer(form, response), how === "repeatable" ? how : undefined);

  const send: Client["send"] = (ticket, body) => {
    // A ticket names a whole address, or a path of the install, which is read against the address the install is reached at.
    if (!URL.canParse(ticket.url, options.server)) return Promise.resolve(failed({ kind: "unexpected", status: OK }));

    const place = new URL(ticket.url, options.server);
    // The token is for the install alone: a ticket that names another place is sent with its own headers and nothing of the login.
    const own = place.origin === new URL(options.server).origin;
    const sent = own && options.token !== undefined ? { ...ticket.headers, Authorization: `Bearer ${options.token}` } : ticket.headers;
    // A stream is sent as it is read, which the request must say.
    const put = (signal: AbortSignal): Promise<Raw> => options.fetch(place.href, { method: ticket.method, headers: sent, body, duplex: "half", redirect: "manual", signal } as RequestInit);

    return ask(FILE_TIMEOUT_MS, (_api, signal) => put(signal), own ? readSent : readElsewhere);
  };

  const download: Client["download"] = ({ site, version, path }) => {
    const send = (api: ApiCalls): Promise<Raw> => api.export.sites[":site"].file.$get({ param: { site }, query: { version: String(version), path } });

    return ask(FILE_TIMEOUT_MS, send, readDownload);
  };

  return { call, send, download };
}
