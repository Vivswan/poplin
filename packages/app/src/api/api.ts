// The HTTP API: every route with its method, its path, and what it takes, answered by one action each. It authenticates, parses, calls, and maps the answer; it holds no rule of its own.
// A client is typed from these declarations, so the two cannot differ. A request carries `Authorization: Bearer <token>`, but for the two routes a computer with no token calls to get one.
// A JSON body goes with `Content-Type: application/json`, a file's bytes with `application/octet-stream`. A done request answers 200 with JSON, or with the bytes of one file; any other answers an `ApiError`.

import { abandonPublish } from "@poplin/core/src/actions/abandon-publish";
import { AUDIT_QUERY, listAudit } from "@poplin/core/src/actions/audit-log";
import { beginImport, type ImportRequest } from "@poplin/core/src/actions/begin-import";
import { beginPublish, type PUBLISH_REQUEST, type UploadLimits } from "@poplin/core/src/actions/begin-publish";
import { SITE_CHANGES, type SiteChanges } from "@poplin/core/src/actions/changes";
import { type LOGIN_REQUEST, LOGIN_SECRET, redeemLogin } from "@poplin/core/src/actions/computer-logins";
import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { DELETE_OPTIONS, deleteSite } from "@poplin/core/src/actions/delete";
import { domainState } from "@poplin/core/src/actions/domain-state";
import { DUPLICATE_REQUEST, duplicateSite } from "@poplin/core/src/actions/duplicate";
import { EXPORT_FILE_QUERY, EXPORT_FILES_QUERY, EXPORT_QUERY, EXPORT_SITE_QUERY, exportFile, exportFiles, exportSettings, exportSite, exportSites } from "@poplin/core/src/actions/export";
import { finishPublish } from "@poplin/core/src/actions/finish-publish";
import { importSettings, SETTINGS_IMPORT } from "@poplin/core/src/actions/import-settings";
import { LIST_QUERY, listSites } from "@poplin/core/src/actions/list";
import { issueToken, listTokens, revokeToken, TOKEN_REQUEST } from "@poplin/core/src/actions/manage-tokens";
import { newLink } from "@poplin/core/src/actions/new-link";
import type { Install } from "@poplin/core/src/actions/records";
import { restoreSite } from "@poplin/core/src/actions/restore";
import { ROLLBACK_OPTIONS, rollbackSite } from "@poplin/core/src/actions/rollback";
import { updateSite } from "@poplin/core/src/actions/set";
import { getSite } from "@poplin/core/src/actions/show";
import { showUpload } from "@poplin/core/src/actions/show-upload";
import { signEveryoneOut } from "@poplin/core/src/actions/sign-out";
import { type Rebuilding, START_OPTIONS, startUpdate } from "@poplin/core/src/actions/start-update";
import { removeUpdateAddress, type UPDATE_ADDRESS_REQUEST, updateAddressState } from "@poplin/core/src/actions/update-address";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import type { SettingValues } from "@poplin/core/src/records/settings";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { methodNotAllowed } from "hono/method-not-allowed";
import * as v from "valibot";

import { carries, counted, type Gate, namesSite, sent } from "./asked";
import { authenticate, type ReadToken } from "./authenticate";
import { answerWhoami, beginWithAddress, checked, FILE_QUERY, saveAddress, storeBody } from "./handlers";
import { queried } from "./query";
import { refusal, respond, respondFile, spentRefusal } from "./respond";

/** The most bytes the JSON body of a route may hold, unless it declares files or imports the settings. */
const JSON_BYTES = 65_536;

/** The most bytes the JSON body that imports the settings may hold: every setting at the longest one change of it can make it. */
const SETTINGS_BYTES = 4 * JSON_BYTES;

/** What a route that takes no query is checked by: any key is one too many. */
const NO_QUERY = v.strictObject({});

/** What one request can carry: a file's bytes, a publish's file count, and the JSON that declares a publish's files. */
export interface ApiLimits extends UploadLimits {
  /** The most bytes the JSON body that begins a publish or an import may hold. */
  readonly manifestBytes: number;
}

/** What the API is given: the install its actions run on, how a token's record is found, and what one request can carry. */
export interface ApiDeps extends Install, Gate {
  /** Finds the record of a token by its id. */
  readonly readToken: ReadToken;

  /** What one request can carry. */
  readonly limits: ApiLimits;

  /** The version of poplin the install runs, as its build stated it. */
  readonly version: string;

  /** Told of every failure a request ends in, before the request is answered 500. */
  readonly report?: (error: unknown) => void;

  /** How the provider starts a rebuild of the install: which addresses it takes, and what sends the one request. The starts are counted in `counters`. */
  readonly rebuild: Omit<Rebuilding, "counters">;
}


/** Declare every route of one install. The type of what it returns is what a client is typed from, so it is inferred, never written. */
function routesOf(deps: ApiDeps) {
  const token = authenticate(deps.readToken, deps.now);
  const json = carries("json");
  const noQuery = queried(NO_QUERY);
  const site = namesSite();
  const rebuilding = { ...deps.rebuild, counters: deps.counters };

  return new Hono()
    .basePath("/api")
    .get("/whoami", token, noQuery, async (context) => respond(await answerWhoami(deps, context.var.token, deps.version)))
    .delete("/token", token, noQuery, async (context) => respond(await revokeToken(deps, context.var.actor, context.var.token.id)))
    .get("/tokens", token, noQuery, async (context) => respond(await listTokens(deps, context.var.actor)))
    .post("/tokens", token, json, noQuery, sent<v.InferInput<typeof TOKEN_REQUEST>>(JSON_BYTES), async (context) => {
      return respond(await checked(TOKEN_REQUEST, context.req.valid("json"), (request) => issueToken(deps, context.var.actor, request)));
    })
    .delete("/tokens/:token", token, noQuery, async (context) => respond(await revokeToken(deps, context.var.actor, context.req.param("token"))))
    .post("/logins", counted("beginLogin", deps), json, noQuery, sent<v.InferInput<typeof LOGIN_REQUEST>>(JSON_BYTES), async (context) => {
      return respond(await beginWithAddress(deps, context.req.valid("json"), new URL(context.req.url).origin, context.var.visitor));
    })
    .post("/logins/token", counted("redeemLogin", deps), json, noQuery, sent<v.InferInput<typeof LOGIN_SECRET>>(JSON_BYTES), async (context) => {
      return respond(await checked(LOGIN_SECRET, context.req.valid("json"), (request) => redeemLogin(deps, request)));
    })

    .get("/sites", token, queried(LIST_QUERY), async (context) => respond(await listSites(deps, context.var.actor, context.req.valid("query"))))
    .get("/sites/:site", token, noQuery, site, async (context) => respond(await getSite(deps, context.var.actor, context.req.param("site"))))
    .patch("/sites/:site", token, json, noQuery, site, sent<SiteChanges>(JSON_BYTES), async (context) => {
      return respond(await checked(SITE_CHANGES, context.req.valid("json"), (changes) => updateSite(deps, context.var.actor, { ...changes, site: context.req.param("site") })));
    })
    .post("/sites/:site/rollback", token, json, noQuery, site, sent<v.InferInput<typeof ROLLBACK_OPTIONS>>(JSON_BYTES), async (context) => {
      return respond(await checked(ROLLBACK_OPTIONS, context.req.valid("json"), (options) => rollbackSite(deps, context.var.actor, { ...options, site: context.req.param("site") })));
    })
    .post("/sites/:site/new-link", token, noQuery, site, async (context) => respond(await newLink(deps, context.var.actor, context.req.param("site"))))
    .delete("/sites/:site", token, queried(DELETE_OPTIONS), site, async (context) => {
      return respond(await deleteSite(deps, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .post("/sites/:site/restore", token, noQuery, site, async (context) => respond(await restoreSite(deps, context.var.actor, context.req.param("site"))))
    .post("/sites/:site/duplicate", token, json, noQuery, site, sent<v.InferInput<typeof DUPLICATE_REQUEST>>(JSON_BYTES), async (context) => {
      return respond(await checked(DUPLICATE_REQUEST, context.req.valid("json"), (asked) => duplicateSite(deps, context.var.actor, { ...asked, site: context.req.param("site") })));
    })

    .post("/uploads", token, json, noQuery, sent<v.InferInput<typeof PUBLISH_REQUEST>>(deps.limits.manifestBytes), async (context) => {
      return respond(await beginPublish(deps, context.var.actor, context.req.valid("json"), deps.limits));
    })
    .get("/uploads/:upload", token, noQuery, async (context) => respond(await showUpload(deps, context.var.actor, context.req.param("upload"))))
    .put("/uploads/:upload/file", token, carries("bytes"), queried(FILE_QUERY), async (context) => {
      const file = { upload: context.req.param("upload"), query: context.req.valid("query"), request: context.req.raw, limits: deps.limits };

      return respond(await storeBody(deps, context.var.actor, file));
    })
    .post("/uploads/:upload/finish", token, noQuery, async (context) => respond(await finishPublish(deps, context.var.actor, context.req.param("upload"))))
    .delete("/uploads/:upload", token, noQuery, async (context) => respond(await abandonPublish(deps, context.var.actor, context.req.param("upload"))))

    .get("/export/settings", token, noQuery, async (context) => respond(await exportSettings(deps, context.var.actor)))
    .get("/export/sites", token, queried(EXPORT_QUERY), async (context) => respond(await exportSites(deps, context.var.actor, context.req.valid("query"))))
    .get("/export/sites/:site", token, queried(EXPORT_SITE_QUERY), site, async (context) => {
      return respond(await exportSite(deps, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .get("/export/sites/:site/files", token, queried(EXPORT_FILES_QUERY), site, async (context) => {
      return respond(await exportFiles(deps, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .get("/export/sites/:site/file", token, queried(EXPORT_FILE_QUERY), site, async (context) => {
      return respondFile(await exportFile(deps, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .post("/import/settings", token, json, noQuery, sent<v.InferInput<typeof SETTINGS_IMPORT>>(SETTINGS_BYTES), async (context) => {
      return respond(await checked(SETTINGS_IMPORT, context.req.valid("json"), (request) => importSettings(deps, context.var.actor, request)));
    })
    .post("/import/sites", token, json, noQuery, sent<ImportRequest>(deps.limits.manifestBytes), async (context) => {
      return respond(await beginImport(deps, context.var.actor, context.req.valid("json"), deps.limits));
    })

    .get("/config", token, noQuery, async (context) => respond(await readConfig(deps, context.var.actor)))
    .patch("/config", token, json, noQuery, sent<Partial<SettingValues>>(JSON_BYTES), async (context) => respond(await changeConfig(deps, context.var.actor, context.req.valid("json"))))
    .delete("/sessions", token, noQuery, async (context) => respond(await signEveryoneOut(deps, context.var.actor)))
    .get("/audit", token, queried(AUDIT_QUERY), async (context) => respond(await listAudit(deps, context.var.actor, context.req.valid("query"))))
    .get("/domain", token, noQuery, async (context) => respond(await domainState(deps, context.var.actor)))

    .post("/update", token, queried(START_OPTIONS), async (context) => {
      return respond(await startUpdate(deps, context.var.actor, { ...context.req.valid("query"), version: deps.version }, rebuilding));
    })
    .get("/update/address", token, noQuery, async (context) => respond(await updateAddressState(deps, context.var.actor)))
    .put("/update/address", token, json, noQuery, sent<v.InferInput<typeof UPDATE_ADDRESS_REQUEST>>(JSON_BYTES), async (context) => {
      return respond(await saveAddress(deps, context.var.actor, context.req.valid("json"), deps.rebuild.accepts));
    })
    .delete("/update/address", token, noQuery, async (context) => respond(await removeUpdateAddress(deps, context.var.actor)));
}

/** The API of one install, as a client is typed from it: every route's method, path, query, body, and answers. */
export type Api = ReturnType<typeof routesOf>;

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
  const app = new Hono();

  app.use(methodNotAllowed({ app, onMethodNotAllowed: (_context, allowed) => refusal("method_not_allowed", undefined, { Allow: allowed.join(", ") }) }));
  app.route("/", routesOf(deps));
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
