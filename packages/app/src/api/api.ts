// The HTTP API: every route of core's table, answered by one action each. It authenticates, parses, calls, and maps the answer; it holds no rule of its own.

import type { UploadLimits } from "@poplin/core/src/actions/begin-publish";
import type { Install } from "@poplin/core/src/actions/records";
import type { Rebuilding } from "@poplin/core/src/actions/start-update";
import { OPEN_ROUTES, ROUTES } from "@poplin/core/src/api/routes";
import type { TokenRecord } from "@poplin/core/src/auth/tokens";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import { siteReference } from "@poplin/core/src/sites/labels";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Counters, Taken } from "../limits/limits";
import { type Authenticated, authenticate, type ReadToken } from "./authenticate";
import { hasContentType, readJson, readQuery } from "./body";
import { type Call, HANDLERS, OPEN_HANDLERS, type OpenName, QUERIES, type RouteName } from "./handlers";
import { refusal, respond, respondFile, spentRefusal } from "./respond";

/** The most bytes the JSON body of a route may hold, unless it declares files or imports the settings. */
const JSON_BYTES = 65_536;

/** The most bytes the JSON body that imports the settings may hold: every setting at the longest one change of it can make it. */
const SETTINGS_BYTES = 4 * JSON_BYTES;

/** The routes whose JSON body declares files, and so may be as long as a manifest. */
const DECLARES_FILES: ReadonlySet<RouteName> = new Set(["beginPublish", "beginImport"]);

/** The most requests one visitor may send a minute to each route that takes no token. A terminal asks for its token twelve times a minute. The pace alone bounds no visitor's waiting logins: core keeps three of each. */
const OPEN_PER_MINUTE: Readonly<Record<OpenName, number>> = { beginLogin: 5, redeemLogin: 25 };

/** The most logins all visitors together may begin a minute. A day then begins 7,200 at most: 28,800 rows written and 417,600 read, under a third of what a free day of the database takes. */
const STARTS_PER_MINUTE = 5;

/** What a counter that cannot answer is taken to say: the minute is full. A login is the guess the count exists to stop, so it is refused where a request for a site is let through. */
const UNCOUNTED = { ok: false, retryAfterSeconds: 60 } as const;

/** What one request can carry: a file's bytes, a publish's file count, and the JSON that declares a publish's files. */
export interface ApiLimits extends UploadLimits {
  /** The most bytes the JSON body that begins a publish or an import may hold. */
  readonly manifestBytes: number;
}

/** What the API is given: the install its actions run on, how a token's record is found, and what one request can carry. */
export interface ApiDeps extends Install {
  /** Finds the record of a token by its id. */
  readonly readToken: ReadToken;

  /** What one request can carry. */
  readonly limits: ApiLimits;

  /** The version of poplin the install runs, as its build stated it. */
  readonly version: string;

  /** Told of every failure a request ends in, before the request is answered 500. */
  readonly report?: (error: unknown) => void;

  /** Where the requests to the routes that take no token are counted, a minute at a time. */
  readonly counters: Pick<Counters, "takeMinute">;

  /** The key one visitor's requests are counted by: `visitorKey` of the address the host itself saw, never of a header a visitor can set. */
  readonly visitorOf: (request: Request) => Promise<string>;

  /** How the provider starts a rebuild of the install: which addresses it takes, and what sends the one request. The starts are counted in `counters`. */
  readonly rebuild: Omit<Rebuilding, "counters">;
}

/** What one request to a route that takes a token is answered from. */
interface Asked {
  /** The request as it came. */
  readonly request: Request;

  /** The segments of the path that the route's pattern names. */
  readonly params: Readonly<Record<string, string>>;

  /** The live token the request presented. */
  readonly token: TokenRecord;
}

function isOpen(name: RouteName): name is OpenName {
  return (OPEN_ROUTES as readonly RouteName[]).includes(name);
}

/** The most bytes the JSON body of a route may hold. */
function bodyCap(name: RouteName, limits: ApiLimits): number {
  if (DECLARES_FILES.has(name)) return limits.manifestBytes;

  return name === "importSettings" ? SETTINGS_BYTES : JSON_BYTES;
}

/** Count one request to a route that takes no token: against its visitor's minute, and a login that fits there against the minute of all logins begun. */
async function takeOpen(name: OpenName, request: Request, deps: ApiDeps): Promise<Taken & { readonly visitor: string }> {
  const visitor = await deps.visitorOf(request);
  const own = await deps.counters.takeMinute({ scope: "visitor", key: `${name}:${visitor}`, limit: OPEN_PER_MINUTE[name] }, deps.now());
  if (!own.ok || name !== "beginLogin") return { ...own, visitor };

  return { ...(await deps.counters.takeMinute({ scope: "install", key: name, limit: STARTS_PER_MINUTE }, deps.now())), visitor };
}

/** Answer one request to a route that takes no token: the counts first, then what was sent, then the route's handler. */
async function answerOpen(name: OpenName, request: Request, deps: ApiDeps): Promise<Response> {
  const taken = await takeOpen(name, request, deps).catch((error: unknown) => {
    // A database that is spent for the day is told as that, never as a full minute.
    if (error instanceof AllowanceSpent) throw error;

    return UNCOUNTED;
  });
  if (!taken.ok) return refusal("too_many_requests", undefined, { "Retry-After": String(Math.max(1, Math.ceil(taken.retryAfterSeconds))) });

  if (!hasContentType(request, ROUTES[name].sends)) return refusal("unsupported_media_type");

  const url = new URL(request.url);
  const query = readQuery(url, {});
  if (!query.ok) return respond(query);

  const sent = await readJson(request, JSON_BYTES);
  if (!sent.ok) return respond(sent);

  return respond(await OPEN_HANDLERS[name]({ install: deps, body: sent.value, origin: url.origin, visitor: taken.visitor }));
}

/** Answer one request to one route that takes a token: what was sent, then the route's handler. */
async function answer(name: Exclude<RouteName, OpenName>, { request, params, token }: Asked, deps: ApiDeps): Promise<Response> {
  const route = ROUTES[name];
  if (!hasContentType(request, route.sends)) return refusal("unsupported_media_type");

  const query = readQuery(new URL(request.url), QUERIES[name] ?? {});
  if (!query.ok) return respond(query);

  const site = params.site ?? "";
  if (params.site !== undefined && !siteReference(site).ok) return refusal("bad_argument", "site");

  const sent = route.sends === "json" ? await readJson(request, bodyCap(name, deps.limits)) : undefined;
  if (sent?.ok === false) return respond(sent);

  const call: Call = {
    install: deps,
    token,
    actor: { scope: token.scope, holder: token.id },
    site,
    named: params.upload ?? params.token ?? "",
    query: query.values,
    body: sent?.value,
    request,
    limits: deps.limits,
    version: deps.version,
    rebuilding: { ...deps.rebuild, counters: deps.counters },
  };

  if (name === "exportFile") return respondFile(await HANDLERS.exportFile(call));

  return respond(await HANDLERS[name](call));
}

/**
 * Build the API of one install.
 *
 * Every request is authenticated by `Authorization: Bearer <token>` alone, and whether the token may do what it asks is decided by the action. One with no live token is answered 401 with `WWW-Authenticate`. `HEAD` is answered as `GET` without its body.
 *
 * The two routes a computer logs in through take no token: they are counted by visitor, the logins begun by all visitors together too, and what they hand out is decided by an admin on the dashboard.
 *
 * @returns the handler of every request under `/api`, which never throws. It answers a path that is no route 404, a route under another method 405 with `Allow`, a database spent for the day 503 with `Retry-After`, and any other failure 500
 */
export function createApi(deps: ApiDeps): { readonly fetch: (request: Request) => Promise<Response> } {
  const app = new Hono<Authenticated>();
  const methods = new Map<string, string[]>();
  const live = authenticate(deps.readToken, deps.now);

  for (const [name, route] of Object.entries(ROUTES) as [RouteName, (typeof ROUTES)[RouteName]][]) {
    methods.set(route.pattern, [...(methods.get(route.pattern) ?? []), route.method]);

    if (isOpen(name)) {
      app.on(route.method, route.pattern, (context) => answerOpen(name, context.req.raw, deps));
      continue;
    }

    app.on(route.method, route.pattern, live, (context) => answer(name, { request: context.req.raw, params: context.req.param(), token: context.get("token") }, deps));
  }

  for (const [pattern, allowed] of methods) app.all(pattern, () => refusal("method_not_allowed", undefined, { Allow: allowed.join(", ") }));

  app.notFound(() => refusal("not_found", "route"));
  app.onError((error) => {
    // The one such error is the refusal of a request with no live token: an answer, and no failure to report.
    if (error instanceof HTTPException) return error.getResponse();

    deps.report?.(error);
    if (error instanceof AllowanceSpent) return spentRefusal(error, deps.now());

    return refusal("internal");
  });

  return { fetch: async (request) => app.fetch(request) };
}
