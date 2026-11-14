// The HTTP API: every route of core's table, answered by one action each. It authenticates, parses, calls, and maps the answer; it holds no rule of its own.

import type { UploadLimits } from "@poplin/core/src/actions/begin-publish";
import type { Install } from "@poplin/core/src/actions/records";
import { ROUTES } from "@poplin/core/src/api/routes";
import { siteReference } from "@poplin/core/src/sites/labels";
import { Hono } from "hono";

import { authenticate, type ReadToken } from "./authenticate";
import { hasContentType, readJson, readQuery } from "./body";
import { type Call, HANDLERS, QUERIES, type RouteName } from "./handlers";
import { refusal, respond, respondFile } from "./respond";

/** The most bytes the JSON body of a route may hold, unless it declares files or imports the settings. */
const JSON_BYTES = 65_536;

/** The most bytes the JSON body that imports the settings may hold: every setting at the longest one change of it can make it. */
const SETTINGS_BYTES = 4 * JSON_BYTES;

/** The routes whose JSON body declares files, and so may be as long as a manifest. */
const DECLARES_FILES: ReadonlySet<RouteName> = new Set(["beginPublish", "beginImport"]);

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

  /** Told of every failure a request ends in, before the request is answered 500. */
  readonly report?: (error: unknown) => void;
}

/** The most bytes the JSON body of a route may hold. */
function bodyCap(name: RouteName, limits: ApiLimits): number {
  if (DECLARES_FILES.has(name)) return limits.manifestBytes;

  return name === "importSettings" ? SETTINGS_BYTES : JSON_BYTES;
}

/** Answer one request to one route: who asks first, then what was sent, then the route's handler. */
async function answer(name: RouteName, request: Request, params: Readonly<Record<string, string>>, deps: ApiDeps): Promise<Response> {
  const route = ROUTES[name];
  const token = await authenticate(request, deps.readToken, deps.now());
  if (token === undefined) return refusal("not_logged_in");

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
  };

  if (name === "exportFile") return respondFile(await HANDLERS.exportFile(call));

  return respond(await HANDLERS[name](call));
}

/**
 * Build the API of one install.
 *
 * Every request is authenticated by `Authorization: Bearer <token>` alone, and whether the token may do what it asks is decided by the action. `HEAD` is answered as `GET` without its body.
 *
 * @returns the handler of every request under `/api`. It answers a path that is no route 404, a route under another method 405 with `Allow`, and a failure of the store or the database 500, and it never throws
 */
export function createApi(deps: ApiDeps): { readonly fetch: (request: Request) => Promise<Response> } {
  const app = new Hono();
  const methods = new Map<string, string[]>();

  for (const [name, route] of Object.entries(ROUTES) as [RouteName, (typeof ROUTES)[RouteName]][]) {
    methods.set(route.pattern, [...(methods.get(route.pattern) ?? []), route.method]);
    app.on(route.method, route.pattern, (context) => answer(name, context.req.raw, context.req.param(), deps));
  }

  for (const [pattern, allowed] of methods) app.all(pattern, () => refusal("method_not_allowed", undefined, { Allow: allowed.join(", ") }));

  app.notFound(() => refusal("not_found", "route"));
  app.onError((error) => {
    deps.report?.(error);

    return refusal("internal");
  });

  return { fetch: async (request) => app.fetch(request) };
}
