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
import { listProblems, noteProblem } from "@poplin/core/src/actions/problems";
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
import type { AddressLayout } from "@poplin/core/src/sites/address-layout";
import { WritesSpent } from "@poplin/core/src/storage/metered";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { methodNotAllowed } from "hono/method-not-allowed";
import * as v from "valibot";

import { followUsers, type UsersFollow } from "../console/access/users-follow";
import { carries, counted, type Gate, metered, namesSite, sent } from "./asked";
import { authenticate, type ReadToken } from "./authenticate";
import { answerWhoami, beginWithAddress, checked, FILE_QUERY, saveAddress, storeBody } from "./handlers";
import { queried } from "./query";
import { refusal, respond, respondFile, spentRefusal, writesSpentRefusal } from "./respond";

/** The most bytes the JSON body of a route may hold, unless it declares files or imports the settings. */
const JSON_BYTES = 65_536;

/** The most bytes the JSON body that imports the settings may hold: every setting at the longest one change of it can make it. */
const SETTINGS_BYTES = 4 * JSON_BYTES;

/** What a route that takes no query is checked by: any key is one too many. */
const NO_QUERY = v.strictObject({});

/** The calls to the database a request with a token makes before its route runs: the one that reads the token's record. */
const TOKEN_CALLS = 1;

/** How many days of problems the API lists: the week `poplin doctor` reports on. */
const PROBLEM_DAYS = 7;

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

  /** How the install's site addresses are laid out. A client reads a typed address with it. */
  readonly layout: AddressLayout;

  /** Told of every failure a request ends in, before the request is answered 500. */
  readonly report?: (error: unknown) => void;

  /** How the provider starts a rebuild of the install: which addresses it takes, and what sends the one request. The starts are counted in `counters`. */
  readonly rebuild: Omit<Rebuilding, "counters">;

  /** The provider's side of the users: a change of the logins is carried there by itself. Without it a change waits for a repair. */
  readonly follow?: UsersFollow;
}

/** Declare every route of one install. The type of what it returns is what a client is typed from, so it is inferred, never written. */
function routesOf(deps: Omit<ApiDeps, "store">, install: ReturnType<typeof metered>) {
  const token = authenticate(deps.readToken, deps.now);
  const json = carries("json");
  const noQuery = queried(NO_QUERY);
  const site = namesSite();
  const rebuilding = { ...deps.rebuild, counters: deps.counters };

  // The answer is the action's own, whatever the provider said: a change that did not reach it waits, and the dashboard says so.
  const carried = async <Answer extends { readonly ok: boolean }>(answer: Answer, logins: boolean): Promise<Answer> => {
    if (deps.follow !== undefined && logins && answer.ok) await followUsers(deps, deps.follow);

    return answer;
  };

  return new Hono()
    .basePath("/api")
    .get("/whoami", token, install, noQuery, async (context) => respond(await answerWhoami(context.var.install, context.var.token, deps)))
    .delete("/token", token, install, noQuery, async (context) => respond(await revokeToken(context.var.install, context.var.actor, context.var.token.id)))
    .get("/tokens", token, install, noQuery, async (context) => respond(await listTokens(context.var.install, context.var.actor)))
    .post("/tokens", token, install, json, noQuery, sent<v.InferInput<typeof TOKEN_REQUEST>>(JSON_BYTES), async (context) => {
      return respond(await checked(TOKEN_REQUEST, context.req.valid("json"), (request) => issueToken(context.var.install, context.var.actor, request)));
    })
    .delete("/tokens/:token", token, install, noQuery, async (context) => respond(await revokeToken(context.var.install, context.var.actor, context.req.param("token"))))
    .post("/logins", counted("beginLogin", deps), install, json, noQuery, sent<v.InferInput<typeof LOGIN_REQUEST>>(JSON_BYTES), async (context) => {
      return respond(await beginWithAddress(context.var.install, context.req.valid("json"), new URL(context.req.url).origin, context.var.visitor));
    })
    .post("/logins/token", counted("redeemLogin", deps), install, json, noQuery, sent<v.InferInput<typeof LOGIN_SECRET>>(JSON_BYTES), async (context) => {
      return respond(await checked(LOGIN_SECRET, context.req.valid("json"), (request) => redeemLogin(context.var.install, request)));
    })

    .get("/sites", token, install, queried(LIST_QUERY), async (context) => respond(await listSites(context.var.install, context.var.actor, context.req.valid("query"))))
    .get("/sites/:site", token, install, noQuery, site, async (context) => respond(await getSite(context.var.install, context.var.actor, context.req.param("site"))))
    .patch("/sites/:site", token, install, json, noQuery, site, sent<SiteChanges>(JSON_BYTES), async (context) => {
      return respond(await checked(SITE_CHANGES, context.req.valid("json"), (changes) => updateSite(context.var.install, context.var.actor, { ...changes, site: context.req.param("site") })));
    })
    .post("/sites/:site/rollback", token, install, json, noQuery, site, sent<v.InferInput<typeof ROLLBACK_OPTIONS>>(JSON_BYTES), async (context) => {
      return respond(await checked(ROLLBACK_OPTIONS, context.req.valid("json"), (options) => rollbackSite(context.var.install, context.var.actor, { ...options, site: context.req.param("site") })));
    })
    .post("/sites/:site/new-link", token, install, noQuery, site, async (context) => respond(await newLink(context.var.install, context.var.actor, context.req.param("site"))))
    .delete("/sites/:site", token, install, queried(DELETE_OPTIONS), site, async (context) => {
      return respond(await deleteSite(context.var.install, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .post("/sites/:site/restore", token, install, noQuery, site, async (context) => respond(await restoreSite(context.var.install, context.var.actor, context.req.param("site"))))
    .post("/sites/:site/duplicate", token, install, json, noQuery, site, sent<v.InferInput<typeof DUPLICATE_REQUEST>>(JSON_BYTES), async (context) => {
      const copy = (asked: v.InferOutput<typeof DUPLICATE_REQUEST>): ReturnType<typeof duplicateSite> => duplicateSite(context.var.install, context.var.actor, { ...asked, site: context.req.param("site") }, TOKEN_CALLS);

      return respond(await checked(DUPLICATE_REQUEST, context.req.valid("json"), copy), deps.now());
    })

    .post("/uploads", token, install, json, noQuery, sent<v.InferInput<typeof PUBLISH_REQUEST>>(deps.limits.manifestBytes), async (context) => {
      return respond(await beginPublish(context.var.install, context.var.actor, context.req.valid("json"), deps.limits), deps.now());
    })
    .get("/uploads/:upload", token, install, noQuery, async (context) => respond(await showUpload(context.var.install, context.var.actor, context.req.param("upload"))))
    .put("/uploads/:upload/file", token, install, carries("bytes"), queried(FILE_QUERY), async (context) => {
      const file = { upload: context.req.param("upload"), query: context.req.valid("query"), request: context.req.raw, limits: deps.limits };

      return respond(await storeBody(context.var.install, context.var.actor, file), deps.now());
    })
    .post("/uploads/:upload/finish", token, install, noQuery, async (context) => respond(await finishPublish(context.var.install, context.var.actor, context.req.param("upload"))))
    .delete("/uploads/:upload", token, install, noQuery, async (context) => respond(await abandonPublish(context.var.install, context.var.actor, context.req.param("upload"))))

    .get("/export/settings", token, install, noQuery, async (context) => respond(await exportSettings(context.var.install, context.var.actor)))
    .get("/export/sites", token, install, queried(EXPORT_QUERY), async (context) => respond(await exportSites(context.var.install, context.var.actor, context.req.valid("query"))))
    .get("/export/sites/:site", token, install, queried(EXPORT_SITE_QUERY), site, async (context) => {
      return respond(await exportSite(context.var.install, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .get("/export/sites/:site/files", token, install, queried(EXPORT_FILES_QUERY), site, async (context) => {
      return respond(await exportFiles(context.var.install, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .get("/export/sites/:site/file", token, install, queried(EXPORT_FILE_QUERY), site, async (context) => {
      return respondFile(await exportFile(context.var.install, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .post("/import/settings", token, install, json, noQuery, sent<v.InferInput<typeof SETTINGS_IMPORT>>(SETTINGS_BYTES), async (context) => {
      return respond(await checked(SETTINGS_IMPORT, context.req.valid("json"), async (request) => carried(await importSettings(context.var.install, context.var.actor, request), request.logins === true)));
    })
    .post("/import/sites", token, install, json, noQuery, sent<ImportRequest>(deps.limits.manifestBytes), async (context) => {
      return respond(await beginImport(context.var.install, context.var.actor, context.req.valid("json"), deps.limits), deps.now());
    })

    .get("/config", token, install, noQuery, async (context) => respond(await readConfig(context.var.install, context.var.actor)))
    .patch("/config", token, install, json, noQuery, sent<Partial<SettingValues>>(JSON_BYTES), async (context) => {
      const changes = context.req.valid("json");

      return respond(await carried(await changeConfig(context.var.install, context.var.actor, changes), typeof changes === "object" && changes !== null && "logins" in changes));
    })
    .delete("/sessions", token, install, noQuery, async (context) => respond(await signEveryoneOut(context.var.install, context.var.actor)))
    .get("/audit", token, install, queried(AUDIT_QUERY), async (context) => respond(await listAudit(context.var.install, context.var.actor, context.req.valid("query"))))
    .get("/domain", token, install, noQuery, async (context) => respond(await domainState(context.var.install, context.var.actor)))
    .get("/problems", token, install, noQuery, async (context) => respond(await listProblems(context.var.install, context.var.actor, PROBLEM_DAYS)))

    .post("/update", token, install, queried(START_OPTIONS), async (context) => {
      return respond(await startUpdate(context.var.install, context.var.actor, { ...context.req.valid("query"), version: deps.version }, rebuilding));
    })
    .get("/update/address", token, install, noQuery, async (context) => respond(await updateAddressState(context.var.install, context.var.actor)))
    .put("/update/address", token, install, json, noQuery, sent<v.InferInput<typeof UPDATE_ADDRESS_REQUEST>>(JSON_BYTES), async (context) => {
      return respond(await saveAddress(context.var.install, context.var.actor, context.req.valid("json"), deps.rebuild.accepts));
    })
    .delete("/update/address", token, install, noQuery, async (context) => respond(await removeUpdateAddress(context.var.install, context.var.actor)));
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
 * @returns the handler of every request under `/api`, which never throws. It answers a path that is no route 404, a route under another method 405 with `Allow`, a database or a store spent for the day 503 with `Retry-After`, and any other failure 500
 */
export function createApi(deps: ApiDeps): { readonly fetch: (request: Request) => Promise<Response> } {
  const app = new Hono();

  app.use(methodNotAllowed({ app, onMethodNotAllowed: (_context, allowed) => refusal("method_not_allowed", undefined, { Allow: allowed.join(", ") }) }));
  app.route("/", routesOf(deps, metered(deps, deps.report)));
  app.notFound(() => refusal("not_found", "route"));
  app.onError(async (error) => {
    // The one such error is the refusal of a request with no live token: an answer, and no failure to report.
    if (error instanceof HTTPException) return error.getResponse();

    // A listing the day has no room for is an answer too.
    if (error instanceof WritesSpent) return writesSpentRefusal(deps.now());

    deps.report?.(error);
    if (error instanceof AllowanceSpent) return spentRefusal(error, deps.now());

    await noteProblem(deps, "api_failed", error);

    return refusal("internal");
  });

  return { fetch: async (request) => app.fetch(request) };
}
