// The client of the HTTP API: its requests are typed from the routes the app declares, and each is answered with a checked value or a failure in words. Nothing it does throws.

import { hc } from "hono/client";
import * as v from "valibot";

import type { Api } from "../../../app/src/api/api";
import { mediaTypeOf } from "../../../core/src/api/media-type";
import { API_ERROR, type ApiError, STORED_TYPE_HEADER } from "../../../core/src/api/routes";
import { textUpTo } from "../../../core/src/api/text-up-to";

/** How long a call that carries JSON, or nothing, may take: 30 seconds. */
const CALL_TIMEOUT_MS = 30_000;

/** How long the upload or the download of one file may take: 10 minutes. */
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

/** One stored file as the install sends it: its bytes, which are read once, their count, and the media type it is served with. */
interface Download {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
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

  /** What aborts when the person stops the command: every call then fails as `stopped`, the ones on their way included. A client without it takes no stop. */
  readonly stopped?: AbortSignal;
}

/** Every route of an install as a request to send, typed by what the route takes. A value that goes into a path is put there as it is given, so it is one a parser or a checked answer made. */
type ApiCalls = ReturnType<typeof hc<Api>>["api"];

/** What is read of an answer here: its status, its headers, and its body. */
type Raw = Pick<Response, "status" | "headers" | "body">;

/** The answer of a route whose done request answers JSON of one form. */
type Answering<Done> = Promise<Raw & { json(): Promise<Done | ApiError> }>;

/** One file of an upload as it is sent: the upload it belongs to, the path it is stored under, its bytes, and the exact count of bytes a stream holds, which is sent as `Content-Length`. */
interface SentFile {
  readonly upload: string;
  readonly path: string;
  readonly body: ReadableStream<Uint8Array> | Uint8Array;
  readonly length?: number;
}

/**
 * A client of one install. None of its three calls throws.
 *
 * `call` sends the one request `ask` makes of the routes, and answers the route's answer, checked against `form`, or the failure. A form the route's answer does not fit does not compile.
 *
 * `upload` sends the bytes of one file of an upload, and answers as `call` does.
 *
 * `download` asks for one stored file of one version of a site. Its bytes are not read here: the caller reads the stream to its end or cancels it, and a read that breaks off throws there.
 */
export interface Client {
  readonly call: <Form extends v.GenericSchema>(form: Form, ask: (api: ApiCalls) => Answering<v.InferOutput<Form>>) => Promise<Called<v.InferOutput<Form>>>;
  readonly upload: <Form extends v.GenericSchema>(form: Form, file: SentFile) => Promise<Called<v.InferOutput<Form>>>;
  readonly download: (file: { readonly site: string; readonly version: number; readonly path: string }) => Promise<Called<Download>>;
}

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

  if (status === 200) return { ok: true, value: parsed.value };

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

/** The media type a header holds percent-encoded; `undefined` for a header that is absent or is no such text. */
function storedType(header: string | null): string | undefined {
  if (header === null) return undefined;

  try {
    return decodeURIComponent(header);
  } catch {
    return undefined;
  }
}

/** Read the answer to a download: the stream with what the headers say of it, or the refusal a JSON body holds. A done answer without its length or its type is none. */
async function readDownload(response: Raw): Promise<Called<Download>> {
  const { status } = response;

  if (status !== 200) {
    const read = await readJson(response);

    return read.ok ? failed({ kind: "unexpected", status }) : read;
  }

  const length = response.headers.get("Content-Length") ?? "";
  const contentType = storedType(response.headers.get(STORED_TYPE_HEADER));

  if (!BYTE_COUNT.test(length) || contentType === undefined) {
    await response.body?.cancel().catch(() => undefined);

    return failed({ kind: "unexpected", status });
  }

  return { ok: true, value: { body: response.body ?? new Blob([]).stream(), size: Number(length), contentType } };
}

/**
 * Build the client of one install.
 *
 * A call waits 30 seconds for its answer, and the upload of one file 10 minutes. A download has 10 minutes from its request to its last byte. No call is sent twice, and no redirect is followed, so the token goes to the install's origin alone.
 */
export function createClient(options: ClientOptions): Client {
  const headers = { Accept: "application/json", ...(options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` }) };

  const ask = async <Done>(patienceMs: number, send: (api: ApiCalls) => Promise<Raw>, read: (response: Raw) => Promise<Called<Done>>): Promise<Called<Done>> => {
    const timeoutMs = options.timeoutMs ?? patienceMs;
    const tooLong = AbortSignal.timeout(timeoutMs);
    const signal = options.stopped === undefined ? tooLong : AbortSignal.any([tooLong, options.stopped]);
    const routes = hc<Api>(options.server, { headers, fetch: (input: RequestInfo | URL, init?: RequestInit) => options.fetch(String(input), { ...init, redirect: "manual", signal }) });

    try {
      return await read(await send(routes.api));
    } catch {
      if (options.stopped?.aborted === true) return failed({ kind: "stopped" });

      if (tooLong.aborted) return failed({ kind: "timeout", seconds: Math.round(timeoutMs / 1000) });

      // What a `fetch` throws is dropped unread: it may quote the request, and the request holds the token.
      return failed({ kind: "unreachable" });
    }
  };

  const call: Client["call"] = (form, send) => ask(CALL_TIMEOUT_MS, send, (response) => readAnswer(form, response));

  const upload: Client["upload"] = (form, file) => {
    const sent = { "Content-Type": "application/octet-stream", ...(file.length === undefined ? {} : { "Content-Length": String(file.length) }) };
    // A stream is sent as it is read, which the request must say.
    const init = { body: file.body, duplex: "half" } as RequestInit;
    const send = (api: ApiCalls): Promise<Raw> => api.uploads[":upload"].file.$put({ param: { upload: file.upload }, query: { path: file.path } }, { headers: sent, init });

    return ask(FILE_TIMEOUT_MS, send, (response) => readAnswer(form, response));
  };

  const download: Client["download"] = ({ site, version, path }) => {
    const send = (api: ApiCalls): Promise<Raw> => api.export.sites[":site"].file.$get({ param: { site }, query: { version: String(version), path } });

    return ask(FILE_TIMEOUT_MS, send, readDownload);
  };

  return { call, upload, download };
}
