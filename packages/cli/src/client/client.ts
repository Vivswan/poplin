// The client of the HTTP API: one call per route of core's table, answered with a checked value or a failure in words. Nothing it does throws.

import * as v from "valibot";

import { ROUTES, type Route } from "../../../core/src/api/routes";
import { SETTING_VALUES } from "../../../core/src/records/settings";

/** How long a call that carries JSON, or nothing, may take: 30 seconds. */
const CALL_TIMEOUT_MS = 30_000;

/** How long the upload of one file may take: 10 minutes. */
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

/** The install's settings as an answer holds them. */
const CONFIG_ANSWER = v.looseObject({ values: SETTING_VALUES });

/** The form of the answer to a done request, for every route this client calls. An answer of another form is a failure, so no command reads a key that is not there. */
const ANSWERS = {
  whoami: v.looseObject({ token: TOKEN }),
  logout: v.looseObject({ token: TOKEN }),
  listSites: v.looseObject({ sites: v.array(SITE), next: v.optional(v.looseObject({ updated_at: v.number(), id: v.string() })) }),
  getSite: SITE_ANSWER,
  updateSite: SITE_ANSWER,
  rollbackSite: SITE_ANSWER,
  newLink: SITE_ANSWER,
  deleteSite: v.looseObject({ before: v.nullable(SITE), site: v.nullable(SITE), left: v.array(v.string()) }),
  restoreSite: SITE_ANSWER,
  beginPublish: v.looseObject({ upload: UPLOAD }),
  showUpload: v.looseObject({ upload: UPLOAD, missing: v.array(v.string()), more: v.boolean() }),
  uploadFile: v.looseObject({ path: v.string(), size: v.number() }),
  finishPublish: v.looseObject({ before: v.nullable(SITE), site: v.looseObject({ ...SITE.entries, created: v.boolean() }), left: v.array(v.string()) }),
  abandonPublish: v.looseObject({ left: v.array(v.string()) }),
  readConfig: CONFIG_ANSWER,
  changeConfig: CONFIG_ANSWER,
} as const;

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

/** What a client is made of. */
interface ClientOptions {
  /** The origin of the install, such as `https://poplin.example.com`. */
  readonly server: string;

  /** The token every request presents. It goes into the `Authorization` header and nowhere else. */
  readonly token: string;

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
 */
export interface Client {
  readonly call: <Name extends CallName>(name: Name, args: ArgsOf<Name>, body?: TypesOf<Name>["body"], length?: number) => Promise<Called<TypesOf<Name>["done"]>>;
}

function failed(failure: Failure): { readonly ok: false; readonly failure: Failure } {
  return { ok: false, failure };
}

/** The headers and the body of one request. A stream is sent as it is read, which the request must say. */
function requestOf(route: Route<never, unknown, unknown>, token: string, body: unknown, length: number | undefined): RequestInit {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
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

/** Read an answer into the route's value or a failure. */
async function readAnswer<Name extends CallName>(name: Name, response: Response): Promise<Called<TypesOf<Name>["done"]>> {
  const { status } = response;
  const text = await readText(response);
  const parsed = text === undefined ? undefined : parseJson(text);
  if (parsed === undefined) return failed({ kind: "not-json", status });

  if (status === 200) {
    if (!v.is(ANSWERS[name], parsed.value)) return failed({ kind: "unexpected", status });

    return { ok: true, value: parsed.value as TypesOf<Name>["done"] };
  }

  const refusal = v.safeParse(REFUSAL, parsed.value);
  if (!refusal.success || status < 400) return failed({ kind: "unexpected", status });

  const { code, message, about } = refusal.output.error;
  if (about === undefined) return failed({ kind: "refused", status, code, message });

  return failed({ kind: "refused", status, code, message, about });
}

/**
 * Build the client of one install.
 *
 * A call waits 30 seconds for its answer, and the upload of one file 10 minutes. No call is sent twice, and no redirect is followed, so the token goes to the install's origin alone.
 */
export function createClient(options: ClientOptions): Client {
  const call: Client["call"] = async (name, args, body, length) => {
    const route = ROUTES[name] as Route<unknown, unknown, unknown>;
    const timeoutMs = options.timeoutMs ?? (route.sends === "bytes" ? FILE_TIMEOUT_MS : CALL_TIMEOUT_MS);
    const request = { ...requestOf(route, options.token, body, length), redirect: "manual" as const, signal: AbortSignal.timeout(timeoutMs) };

    try {
      return await readAnswer(name, await options.fetch(`${options.server}${route.path(args)}`, request));
    } catch {
      if (request.signal.aborted) return failed({ kind: "timeout", seconds: Math.round(timeoutMs / 1000) });

      // What a `fetch` throws is dropped unread: it may quote the request, and the request holds the token.
      return failed({ kind: "unreachable" });
    }
  };

  return { call };
}
