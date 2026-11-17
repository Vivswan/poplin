// The HTTP API: every route with its method, its path, and what it takes, answered by one action each. It authenticates, parses, calls, and maps the answer; it holds no rule of its own.
// A client is typed from these declarations, so the two cannot differ. A request carries `Authorization: Bearer <token>`, but for the two routes a computer with no token calls to get one.
// A JSON body goes with `Content-Type: application/json`, a file's bytes to the address and with the headers the file's ticket names.
// A done request answers 200 with JSON, or with the bytes of one file; any other answers an `ApiError`.
// A route that changes a site or the settings takes `?dry_run=true`: its action then answers what the change would come to, or its refusal, and writes nothing.

import { AUDIT_QUERY, listAudit } from "@poplin/core/src/actions/audit-log";
import { beginImport, type ImportRequest } from "@poplin/core/src/actions/begin-import";
import { beginPublish, type PUBLISH_REQUEST, type UploadLimits } from "@poplin/core/src/actions/begin-publish";
import { SITE_CHANGES, type SiteChanges } from "@poplin/core/src/actions/changes";
import { type LOGIN_REQUEST, LOGIN_SECRET, redeemLogin } from "@poplin/core/src/actions/computer-logins";
import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { DELETE_OPTIONS, deleteSite } from "@poplin/core/src/actions/delete";
import { domainState } from "@poplin/core/src/actions/domain-state";
import { cancelCopy, DUPLICATE_REQUEST, duplicateSite, rehearseDuplicate } from "@poplin/core/src/actions/duplicate";
import { EXPORT_FILE_QUERY, EXPORT_FILES_QUERY, EXPORT_QUERY, EXPORT_SITE_QUERY, exportFile, exportFiles, exportSettings, exportSite, exportSites } from "@poplin/core/src/actions/export";
import { finishPublish } from "@poplin/core/src/actions/finish-publish";
import { importSettings, SETTINGS_IMPORT } from "@poplin/core/src/actions/import-settings";
import { type issueTickets, TICKETS_REQUEST } from "@poplin/core/src/actions/issue-tickets";
import { LIST_QUERY, listSites } from "@poplin/core/src/actions/list";
import { issueToken, listTokens, revokeToken, TOKEN_REQUEST } from "@poplin/core/src/actions/manage-tokens";
import { newLink } from "@poplin/core/src/actions/new-link";
import { listProblems, noteProblem } from "@poplin/core/src/actions/problems";
import { type Install, REHEARSAL, type Rehearsal } from "@poplin/core/src/actions/records";
import { restoreSite } from "@poplin/core/src/actions/restore";
import { ROLLBACK_OPTIONS, rollbackSite } from "@poplin/core/src/actions/rollback";
import { updateSite } from "@poplin/core/src/actions/set";
import { getSite } from "@poplin/core/src/actions/show";
import { showUpload } from "@poplin/core/src/actions/show-upload";
import { type EndLogins, signEveryoneOut } from "@poplin/core/src/actions/sign-out";
import { type SelfUpdate, startUpdate, UPDATE_REQUEST } from "@poplin/core/src/actions/start-update";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import { inlineJobs } from "@poplin/core/src/jobs/inline-jobs";
import type { Jobs } from "@poplin/core/src/jobs/jobs";
import type { SettingValues } from "@poplin/core/src/records/settings";
import type { AddressLayout } from "@poplin/core/src/sites/address-layout";
import { WritesSpent } from "@poplin/core/src/storage/metered";
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { methodNotAllowed } from "hono/method-not-allowed";
import * as v from "valibot";

import { followUsers, type UsersFollow } from "../console/access/users-follow";
import { holding, type Later } from "../console/later";
import { carryLogs, type LogsFollow, namesLogs } from "../console/settings/logs-follow";
import { carryRules, namesRule, type RulesFollow } from "../console/settings/rules-follow";
import { carries, counted, type Gate, metered, namesSite, sent } from "./asked";
import { authenticate, type ReadToken } from "./authenticate";
import { answerUpdateState, answerWhoami, beginWithAddress, checked, type Direct, FILE_QUERY, storeBody, ticketed, ticketsFor } from "./handlers";
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

  /** What takes a release and puts it in place of the running code. The starts are counted in `counters`. */
  readonly update: SelfUpdate;

  /** The provider's side of the users: a change of the logins is carried there by itself. Without it a change waits for a repair. */
  readonly follow?: UsersFollow;

  /** The host's background work, which runs the rounds of a copy after its first request's. Without it the client's own requests run them, one each. */
  readonly jobs?: Jobs;

  /** Ends every login of the dashboard at the provider. Without it nobody can be signed out here. */
  readonly endLogins?: EndLogins;

  /** The provider's side of the domain's rules: a change of a setting they are written from is carried there by itself. Without it such a change waits for a repair. */
  readonly rules?: RulesFollow;

  /** The provider's side of the install's logs: a change of the setting that keeps them is carried there by itself. Without it such a change waits for the next update or repair. */
  readonly logs?: LogsFollow;

  /** The host's tickets that send an upload's files straight to the store. Without them, and whenever they answer none, the install takes every file itself. */
  readonly direct?: Direct;
}

/**
 * Carry a stored change of the settings to the provider: the users before the answer, and the settings of the domain's rules and of the logs with no answer held for them where the host holds the request open.
 *
 * @param named - whether the change named the logins, whether it named a setting the domain's rules are written from, and whether it named the setting of the logs
 * @returns the action's own answer, whatever the provider said: a change that did not reach it waits, and the dashboard says so
 */
async function carried<Answer extends { readonly ok: boolean; readonly values?: Pick<SettingValues, "provider_logs"> }>(
  deps: Omit<ApiDeps, "store">,
  context: Context,
  answer: Answer,
  named: { readonly logins: boolean; readonly rules: boolean; readonly logs: boolean },
): Promise<Answer> {
  if (!answer.ok) return answer;

  if (deps.follow !== undefined && named.logins) await followUsers(deps, deps.follow);

  if (named.rules) await carryRules(context, deps, deps.rules);

  if (named.logs && answer.values !== undefined) await carryLogs(context, deps, deps.logs, answer.values.provider_logs);

  return answer;
}

/** Copy a site, or say what the copy would be where the request asks for a dry run. */
async function duplicated(
  asking: { readonly install: Install; readonly actor: Parameters<typeof duplicateSite>[1] },
  request: Parameters<typeof duplicateSite>[2],
  how: Rehearsal,
  jobs: Jobs,
): Promise<Awaited<ReturnType<typeof duplicateSite | typeof rehearseDuplicate>>> {
  return how.dry_run === true ? rehearseDuplicate(asking.install, asking.actor, request) : duplicateSite(asking.install, asking.actor, request, TOKEN_CALLS, jobs);
}

/** Declare every route of one install. The type of what it returns is what a client is typed from, so it is inferred, never written. */
function routesOf(deps: Omit<ApiDeps, "store">, install: ReturnType<typeof metered>) {
  const token = authenticate(deps.readToken, deps.now);
  const json = carries("json");
  const noQuery = queried(NO_QUERY);
  const rehearsal = queried(REHEARSAL);
  const site = namesSite();
  const updating = { self: deps.update, counters: deps.counters };
  const jobs = deps.jobs ?? inlineJobs;

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
    .patch("/sites/:site", token, install, json, rehearsal, site, sent<SiteChanges>(JSON_BYTES), async (context) => {
      return respond(await checked(SITE_CHANGES, context.req.valid("json"), (changes) => updateSite(context.var.install, context.var.actor, { ...changes, ...context.req.valid("query"), site: context.req.param("site") })));
    })
    .post("/sites/:site/rollback", token, install, json, rehearsal, site, sent<v.InferInput<typeof ROLLBACK_OPTIONS>>(JSON_BYTES), async (context) => {
      return respond(await checked(ROLLBACK_OPTIONS, context.req.valid("json"), (options) => rollbackSite(context.var.install, context.var.actor, { ...options, ...context.req.valid("query"), site: context.req.param("site") })));
    })
    .post("/sites/:site/new-link", token, install, rehearsal, site, async (context) => respond(await newLink(context.var.install, context.var.actor, context.req.param("site"), context.req.valid("query"))))
    .delete("/sites/:site", token, install, queried(DELETE_OPTIONS), site, async (context) => {
      return respond(await deleteSite(context.var.install, context.var.actor, { ...context.req.valid("query"), site: context.req.param("site") }));
    })
    .post("/sites/:site/restore", token, install, rehearsal, site, async (context) => respond(await restoreSite(context.var.install, context.var.actor, context.req.param("site"), context.req.valid("query"))))
    .post("/sites/:site/duplicate", token, install, json, rehearsal, site, sent<v.InferInput<typeof DUPLICATE_REQUEST>>(JSON_BYTES), async (context) => {
      const copy = (asked: v.InferOutput<typeof DUPLICATE_REQUEST>): ReturnType<typeof duplicated> => duplicated(context.var, { ...asked, site: context.req.param("site") }, context.req.valid("query"), jobs);

      return respond(await checked(DUPLICATE_REQUEST, context.req.valid("json"), copy), deps.now());
    })

    .post("/uploads", token, install, json, noQuery, sent<v.InferInput<typeof PUBLISH_REQUEST>>(deps.limits.manifestBytes), async (context) => {
      return respond(await beginPublish(ticketed(context.var.install, deps.direct), context.var.actor, context.req.valid("json"), deps.limits), deps.now());
    })
    .get("/uploads/:upload", token, install, noQuery, async (context) => respond(await showUpload(context.var.install, context.var.actor, context.req.param("upload"))))
    .post("/uploads/:upload/tickets", token, install, json, noQuery, sent<v.InferInput<typeof TICKETS_REQUEST>>(JSON_BYTES), async (context) => {
      const issue = (asked: v.InferOutput<typeof TICKETS_REQUEST>): ReturnType<typeof issueTickets> => ticketsFor(context.var.install, context.var.actor, { ...asked, upload: context.req.param("upload") }, deps.direct);

      return respond(await checked(TICKETS_REQUEST, context.req.valid("json"), issue));
    })
    .put("/uploads/:upload/file", token, install, carries("bytes"), queried(FILE_QUERY), async (context) => {
      const file = { upload: context.req.param("upload"), query: context.req.valid("query"), request: context.req.raw, limits: deps.limits };

      return respond(await storeBody(context.var.install, context.var.actor, file), deps.now());
    })
    .post("/uploads/:upload/finish", token, install, noQuery, async (context) => respond(await finishPublish(context.var.install, context.var.actor, context.req.param("upload"))))
    .delete("/uploads/:upload", token, install, noQuery, async (context) => respond(await cancelCopy(context.var.install, context.var.actor, context.req.param("upload"), jobs)))

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
      // A backup holds every setting, the ones the domain's rules are written from and the one of the logs among them.
      return respond(await checked(SETTINGS_IMPORT, context.req.valid("json"), async (request) => carried(deps, context, await importSettings(context.var.install, context.var.actor, request), { logins: request.logins === true, rules: true, logs: true })));
    })
    .post("/import/sites", token, install, json, noQuery, sent<ImportRequest>(deps.limits.manifestBytes), async (context) => {
      return respond(await beginImport(ticketed(context.var.install, deps.direct), context.var.actor, context.req.valid("json"), deps.limits), deps.now());
    })

    .get("/config", token, install, noQuery, async (context) => respond(await readConfig(context.var.install, context.var.actor)))
    .patch("/config", token, install, json, rehearsal, sent<Partial<SettingValues>>(JSON_BYTES), async (context) => {
      const [changes, how] = [context.req.valid("json"), context.req.valid("query")];
      // A change that is not stored is carried nowhere.
      const stored = how.dry_run !== true;
      const named = { logins: stored && typeof changes === "object" && changes !== null && "logins" in changes, rules: stored && namesRule(changes), logs: stored && namesLogs(changes) };

      return respond(await carried(deps, context, await changeConfig(context.var.install, context.var.actor, changes, how), named));
    })
    .delete("/sessions", token, install, noQuery, async (context) => respond(await signEveryoneOut(context.var.install, context.var.actor, deps.endLogins)))
    .get("/audit", token, install, queried(AUDIT_QUERY), async (context) => respond(await listAudit(context.var.install, context.var.actor, context.req.valid("query"))))
    .get("/domain", token, install, noQuery, async (context) => respond(await domainState(context.var.install, context.var.actor)))
    .get("/problems", token, install, noQuery, async (context) => respond(await listProblems(context.var.install, context.var.actor, PROBLEM_DAYS)))

    .get("/update", token, install, noQuery, async (context) => respond(await answerUpdateState(context.var.install, context.var.actor, { version: deps.version, self: deps.update })))
    .post("/update", token, install, queried(UPDATE_REQUEST), async (context) => respond(await startUpdate(context.var.install, context.var.actor, { version: deps.version, to: context.req.valid("query").to }, updating)));
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
 * @returns the handler of every request under `/api`, which never throws. Given what the host holds a request open with, work an answer is not held for runs on past it.
 *   It answers a path that is no route 404, a route under another method 405 with `Allow`, a database or a store spent for the day 503 with `Retry-After`, and any other failure 500
 */
export function createApi(deps: ApiDeps): { readonly fetch: (request: Request, later?: Later) => Promise<Response> } {
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

  return { fetch: async (request, later) => app.fetch(request, holding(later)) };
}
