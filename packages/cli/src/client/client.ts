// The client of the HTTP API: one call per route of core's table, answered with a checked value or a failure in words. Nothing it does throws.

import * as v from "valibot";

import { ROUTES, type Route, STORED_TYPE_HEADER } from "../../../core/src/api/routes";
import { SETTING_VALUES } from "../../../core/src/records/settings";

/** How long a call that carries JSON, or nothing, may take: 30 seconds. */
const CALL_TIMEOUT_MS = 30_000;

/** How long the upload or the download of one file may take: 10 minutes. */
const FILE_TIMEOUT_MS = 600_000;

/** The most bytes of an answer that are read: 16 MB, far above a page of a hundred sites. */
const MAX_ANSWER_BYTES = 16_000_000;

/** A site as an answer holds it. Keys beyond these are kept as sent. */
const SITE = v.looseObject({
  id: v.string(),
  label: v.string(),
  name: v.string(),
  public_name: v.nullable(v.string()),
  title: v.nullable(v.string()),
  access: v.picklist(["private", "unlisted", "public"]),
  url: v.string(),
  addresses: v.looseObject({ site: v.string(), public: v.nullable(v.string()) }),
  search_engines: v.boolean(),
  embeddable: v.boolean(),
  expires: v.union([v.literal("never"), v.number()]),
  versions: v.array(v.looseObject({ number: v.number(), published: v.number(), published_by: v.string() })),
  live_version: v.number(),
  bytes: v.number(),
  files: v.number(),
  updated: v.number(),
  state: v.picklist(["live", "trash"]),
  views: v.nullable(v.looseObject({ today: v.number(), week: v.number() })),
  gone_on: v.optional(v.number()),
});

/** A token as an answer holds it: never the token itself. */
const TOKEN = v.looseObject({
  id: v.string(),
  scope: v.picklist(["admin", "publisher"]),
  note: v.string(),
  created: v.number(),
  expires: v.union([v.literal("never"), v.number()]),
});

/** A staged publish as an answer holds it. */
const UPLOAD = v.looseObject({ id: v.string(), state: v.string(), version: v.number(), files: v.number(), bytes: v.number(), expires: v.number() });

/** The answer of an action on one site. */
const SITE_ANSWER = v.looseObject({ before: v.nullable(SITE), site: SITE });

/** A site as a backup holds it: what names it, and what each version it keeps holds. Every other key is kept as sent, and checked by the install that imports it. */
const STORED_SITE = v.looseObject({
  id: v.string(),
  name: v.string(),
  live_version: v.number(),
  versions: v.array(v.looseObject({ number: v.number(), files: v.number(), bytes: v.number() })),
});

/** The install's settings as an answer holds them. */
const CONFIG_ANSWER = v.looseObject({ values: SETTING_VALUES });

/** The form of the answer to a done request, for every route this client calls. An answer of another form is a failure, so no command reads a key that is not there. */
const ANSWERS = {
  whoami: v.looseObject({ token: TOKEN }),
  logout: v.looseObject({ token: TOKEN }),
  beginLogin: v.looseObject({ code: v.string(), secret: v.string(), verify_url: v.string(), expires_in: v.number(), interval: v.number() }),
  redeemLogin: v.variant("state", [
    v.looseObject({ state: v.picklist(["pending", "slow_down", "denied", "expired"]) }),
    v.looseObject({ state: v.literal("allowed"), token: v.string(), record: TOKEN }),
  ]),
  listSites: v.looseObject({ sites: v.array(SITE), next: v.optional(v.looseObject({ updated_at: v.number(), id: v.string() })) }),
  getSite: SITE_ANSWER,
  updateSite: SITE_ANSWER,
  rollbackSite: SITE_ANSWER,
  newLink: SITE_ANSWER,
  deleteSite: v.looseObject({ before: v.nullable(SITE), site: v.nullable(SITE), left: v.array(v.string()) }),
  restoreSite: SITE_ANSWER,
  duplicateSite: v.looseObject({
    before: v.null(),
    site: v.nullable(v.looseObject({ ...SITE.entries, created: v.boolean() })),
    copy: v.looseObject({ upload: v.string(), copied: v.number(), files: v.number() }),
  }),
  beginPublish: v.looseObject({ upload: UPLOAD }),
  showUpload: v.looseObject({ upload: UPLOAD, missing: v.array(v.string()), more: v.boolean() }),
  uploadFile: v.looseObject({ path: v.string(), size: v.number() }),
  finishPublish: v.looseObject({ before: v.nullable(SITE), site: v.looseObject({ ...SITE.entries, created: v.boolean() }), left: v.array(v.string()) }),
  abandonPublish: v.looseObject({ left: v.array(v.string()) }),
  exportSettings: v.looseObject({ format: v.number(), settings: v.record(v.string(), v.string()) }),
  exportSites: v.looseObject({ format: v.number(), sites: v.array(STORED_SITE), next: v.optional(v.string()) }),
  exportSite: v.looseObject({ format: v.number(), site: STORED_SITE }),
  exportFiles: v.looseObject({ files: v.array(v.looseObject({ path: v.string(), size: v.number() })), next: v.optional(v.string()) }),
  importSettings: CONFIG_ANSWER,
  beginImport: v.looseObject({ upload: UPLOAD }),
  readConfig: CONFIG_ANSWER,
  changeConfig: CONFIG_ANSWER,
} as const;

/** The route that answers one stored file's bytes, which no JSON form describes. */
const FILE_ROUTE = ROUTES.exportFile;

/** A count of bytes as a header writes it. */
const BYTE_COUNT = /^\d{1,15}$/;

/** The body of every refusal of the API. */
const REFUSAL = v.looseObject({ error: v.looseObject({ code: v.string(), message: v.string(), about: v.optional(v.string()) }) });

/** Every route this client calls, by its name in core's table. */
export const CALL_NAMES = Object.keys(ANSWERS) as readonly CallName[];

/** The name of a route this client calls. */
export type CallName = keyof typeof ANSWERS;

type ArgsOf<Name extends CallName> = Parameters<(typeof ROUTES)[Name]["path"]>[0];

type TypesOf<Name extends CallName> = NonNullable<(typeof ROUTES)[Name]["types"]>;

/** The platform's `fetch`, or a stand-in for it. */
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Why a call got no answer to use.
 *
 * `refused` is the API's own refusal, with its code. `unreachable` is a request that never got an answer, `timeout` one that took too long.
 * `not-json` is an answer that is no JSON, such as a proxy's error page, and `unexpected` one that is JSON of a form the API never sends, or a redirect.
 */
export type Failure =
  | { readonly kind: "refused"; readonly status: number; readonly code: string; readonly message: string; readonly about?: string }
  | { readonly kind: "unreachable" }
  | { readonly kind: "timeout"; readonly seconds: number }
  | { readonly kind: "not-json"; readonly status: number }
  | { readonly kind: "unexpected"; readonly status: number };

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
}

/**
 * A client of one install.
 *
 * `call` takes the route's arguments, then the JSON value or the bytes of one file of a route that sends one, then the exact count of bytes a stream holds, which is sent as `Content-Length`.
 * It answers the route's answer, checked against the form the route answers in, or the failure, and never throws.
 *
 * `download` asks for one stored file of one version of a site. Its bytes are not read here: the caller reads the stream to its end or cancels it, and a read that breaks off throws there.
 */
export interface Client {
  readonly call: <Name extends CallName>(name: Name, args: ArgsOf<Name>, body?: TypesOf<Name>["body"], length?: number) => Promise<Called<TypesOf<Name>["done"]>>;
  readonly download: (args: Parameters<typeof FILE_ROUTE.path>[0]) => Promise<Called<Download>>;
}

/** What goes with one request: the JSON value or the bytes of a route that sends one, and the count of bytes a stream holds. */
interface Sent {
  readonly body?: unknown;
  readonly length?: number | undefined;
}

function failed(failure: Failure): { readonly ok: false; readonly failure: Failure } {
  return { ok: false, failure };
}

/** The headers and the body of one request. A stream is sent as it is read, which the request must say. */
function requestOf(route: Route<never, unknown, unknown>, token: string | undefined, body: unknown, length: number | undefined): RequestInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;

  if (route.sends === "nothing") return { method: route.method, headers };

  if (route.sends === "json") return { method: route.method, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) };

  headers["Content-Type"] = "application/octet-stream";
  if (length !== undefined) headers["Content-Length"] = String(length);

  return { method: route.method, headers, body: body as BodyInit, duplex: "half" } as RequestInit;
}

/** The text of an answer, read up to the cap; `undefined` for one that is longer. */
async function readText(response: Response): Promise<string | undefined> {
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;

  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes += chunk.value.byteLength;
      if (bytes > MAX_ANSWER_BYTES) return undefined;

      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return text + decoder.decode();
}

function parseJson(text: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** Read an answer that is JSON into the value a done answer holds, or into the failure any other answer is. */
async function readJson(response: Response): Promise<Called<unknown>> {
  const { status } = response;
  const text = await readText(response);
  const parsed = text === undefined ? undefined : parseJson(text);
  if (parsed === undefined) return failed({ kind: "not-json", status });

  if (status === 200) return { ok: true, value: parsed.value };

  const refusal = v.safeParse(REFUSAL, parsed.value);
  if (!refusal.success || status < 400) return failed({ kind: "unexpected", status });

  const { code, message, about } = refusal.output.error;
  if (about === undefined) return failed({ kind: "refused", status, code, message });

  return failed({ kind: "refused", status, code, message, about });
}

/** Read an answer into the route's value or a failure. */
async function readAnswer<Name extends CallName>(name: Name, response: Response): Promise<Called<TypesOf<Name>["done"]>> {
  const read = await readJson(response);
  if (!read.ok) return read;

  if (!v.is(ANSWERS[name], read.value)) return failed({ kind: "unexpected", status: response.status });

  return { ok: true, value: read.value as TypesOf<Name>["done"] };
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
async function readDownload(response: Response): Promise<Called<Download>> {
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
  const ask = async <Done>(route: Route<never, unknown, unknown>, path: string, sent: Sent, read: (response: Response) => Promise<Called<Done>>): Promise<Called<Done>> => {
    const carriesFile = route.sends === "bytes" || route.answers === "bytes";
    const timeoutMs = options.timeoutMs ?? (carriesFile ? FILE_TIMEOUT_MS : CALL_TIMEOUT_MS);
    const request = { ...requestOf(route, options.token, sent.body, sent.length), redirect: "manual" as const, signal: AbortSignal.timeout(timeoutMs) };

    try {
      return await read(await options.fetch(`${options.server}${path}`, request));
    } catch {
      if (request.signal.aborted) return failed({ kind: "timeout", seconds: Math.round(timeoutMs / 1000) });

      // What a `fetch` throws is dropped unread: it may quote the request, and the request holds the token.
      return failed({ kind: "unreachable" });
    }
  };

  const call: Client["call"] = (name, args, body, length) => {
    const route = ROUTES[name] as Route<unknown, unknown, unknown>;

    return ask(route as Route<never, unknown, unknown>, route.path(args), { body, length }, (response) => readAnswer(name, response));
  };

  const download: Client["download"] = (args) => ask(FILE_ROUTE as Route<never, unknown, unknown>, FILE_ROUTE.path(args), {}, readDownload);

  return { call, download };
}
