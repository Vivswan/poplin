// The Worker: every request and every scheduled run enters here.
//
//   <admin host>/api and below       the API, which checks the bearer token itself; its two login routes take none and are counted by visitor
//   <admin host>/...                 the dashboard: the Access token and the users, on every request
//   any other hostname               the Access token under `p`, the limits, then serving; one that is no site's gets serving's own 404
//
// Which hostname is which is said by the instance's `hosts`, the one value built from the install's kind.
//
// Access stands in front of the whole admin hostname at the edge, but for the paths of `INSTALL_OBJECTS.openPaths`. Each of those has its answer in `OPEN`, and every other path is the dashboard's.
// The dashboard keeps no session of its own: the token Access puts on a request is checked on each one, and its email against the users.
//
// An instance starts on its first request, and every request that arrives meanwhile waits on that one start.
// A start that succeeded is kept. A failed one is answered to the requests that waited on it, and the next request starts again, with one exception.
// A start whose schema step failed right after an update asks once, for the instance, to go back to the code before it, and its answer says what came of that.
// Only where the install did go back is that failed start kept: its step is not tried again, since one that then ran would leave the code before a database it cannot read.
//
// A site request trusts settings and users read up to a minute ago. The dashboard reads them anew on every request,
// so a removed user loses the dashboard at once and the private sites within the minute. A dashboard request that only reads uses that one read for all it answers.

import { createConsole } from "@poplin/app/src/console/console";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import { admit } from "@poplin/app/src/login/admit";
import { toHttps } from "@poplin/app/src/transport/to-https";
import { meterNoted, noteProblem } from "@poplin/core/src/actions/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { Database } from "@poplin/core/src/database/database";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import { clientAddress } from "../limits/client-address";
import { FREE_LIMITS } from "../limits/free-limits";
import { jobsEntrypoint } from "../jobs/workflow";
import { INSTALL_OBJECTS } from "../install/install-objects";
import type { Bindings } from "./bindings";
import { CLIENT_FILES } from "./client-files";
import { faultOf, logFault } from "./fault";
import { createHolding, type Held, SETTINGS_LIFETIME_MS, type SiteHeld } from "./held";
import { answerSite } from "./site";
import { answerSpent } from "./spent";
import { type Failure, type Instance, type Outside, type Started, startInstance, whyRefused } from "./start";
import { runSweep } from "./sweep";
import { plain } from "./util";

/** The dashboard trusts no earlier read. */
const FRESH = 0;

/** The answer to a request that met a failure of the database or the bucket. */
const TRY_AGAIN = "Something went wrong. Try again.";

/** The answer of an install whose database another build of poplin made: by a schema step that was not this code's, or with settings this code does not read. */
const MADE_BY_ANOTHER_BUILD = "This install's database was made by another build of poplin, so its records are not the ones this build reads. Roll the Worker back to that build, or run `npx poplin uninstall` and install anew.";

/** What a request waits for after the install went back by itself: Cloudflare serves the code before some ten seconds after it is asked to. */
const SOON = "Reload in a minute.";

/** What a scheduled run that failed is thrown as. */
const SWEEP_FAILED = "the sweep failed";

/** The whole answer of a Worker with nothing set: its code is in place, and no install command has finished it. It names the command of this provider and nothing of the account. */
const NOT_FINISHED = "This poplin is not finished.\nRun: npx poplin install cloudflare";

/** The path, on every hostname Access guards, where Access ends the login of the browser that opens it. It never reaches the Worker: the dashboard's way out sends a browser on to it. */
const LOGOUT_PATH = "/cdn-cgi/access/logout";

/** Where the variables of an install come from, for a person whose Worker lost or mistyped one. */
const SET_THEM = "The install command writes them. In the Cloudflare dashboard they are under Workers & Pages, this Worker, Settings, Variables and Secrets.";

/** What answers each path Access lets past its login, and everything below it. A path the list gains has no answer here until one is written, and the Worker does not build without it. */
const OPEN: Readonly<Record<(typeof INSTALL_OBJECTS.openPaths)[number], (request: Request, instance: Instance, ways: Ways, open: ExecutionContext | undefined) => Promise<Response>>> = {
  "/api": async (request, instance, _ways, open) => instance.api.fetch(request, laterOf(open)),
};

/** What a request is answered through: the settings its instance holds, read no longer ago than `lifetime` milliseconds, and the same for a site request. */
interface Ways {
  readonly held: (lifetime: number) => Promise<Held>;
  readonly siteHeld: SiteHeld;
}

/** What one Worker instance answers through: its two handlers, and `starting`, which answers the instance those two run on, for the steps of a job. */
type Handlers = Required<Pick<ExportedHandler<Bindings>, "fetch" | "scheduled">> & { readonly starting: (env: Bindings) => Promise<Started> };

/** A start that failed, as apart from a Worker with nothing set, which is no failure. */
type Stopped = Exclude<Failure, { readonly kind: "unset" }>;

/** The install going back by itself, where it may: the versions it went between, or `undefined` where nothing was changed. */
type WentBack = (failure: Extract<Failure, { readonly kind: "failed" }>) => ReturnType<typeof failure.back>;

/** What stopped an instance, for whoever runs the install. It names each variable and never a value of one. */
function failureText(failure: Stopped): string {
  if (failure.kind === "binding") {
    const lines = failure.refused.map(({ binding, refusal }) => `  ${binding}: ${refusal}`);

    return ["This poplin install cannot start. These variables of its Worker are missing or wrong:", "", ...lines, "", SET_THEM].join("\n");
  }

  if (failure.kind === "newer") return "This install's database is newer than its code: update poplin.";

  if (failure.kind === "differs") return MADE_BY_ANOTHER_BUILD;

  return "This install's database could not be brought up to date. Try again.";
}

/** Answer a request whose instance could not start. A schema step that failed after an update is answered once the install went back, where it may. */
async function failureAnswer(request: Request, failure: Stopped, wentBack: WentBack): Promise<Response> {
  const went = failure.kind === "failed" ? await wentBack(failure) : undefined;
  if (went === undefined) return plain(request, 503, failureText(failure));

  return plain(request, 503, `The update to ${went.from} could not change the database. poplin went back to ${went.to}. ${SOON}`);
}

/** What the API and the dashboard hand the work they hold no answer for: the invocation is held open for it, where one is. */
function laterOf(open: ExecutionContext | undefined): ((work: Promise<unknown>) => void) | undefined {
  return open === undefined ? undefined : (work) => open.waitUntil(work);
}

/** Where the dashboard answers: every path of the admin hostname that Access guards. Who asks is decided on each request, from its Access token and the users just read. */
async function answerDashboard(request: Request, instance: Instance, held: Held, open: ExecutionContext | undefined): Promise<Response> {
  const now = instance.install.now();
  // As the API does: every listing of the bucket this request makes is counted against the day, and written down once. What goes wrong with the count is noted.
  const meter = meterNoted(instance.install);
  // A request that changes nothing takes the settings its user was just checked against. A change reads them itself, inside its own step.
  const known = request.method === "GET" ? { knownSettings: held.settings } : {};
  const dashboard = createConsole({
    install: { ...instance.install, store: meter.store, ...known },
    version: instance.version,
    admit: async (headers) => {
      const who = await admit(headers, { identify: instance.identify, logins: held.logins, now });
      if (who.ok) return who;

      // Logged by its kind, never with a value of the request.
      console.warn(`poplin: a request for the dashboard was refused: ${who.refusal}`);
      const refusal = whyRefused(who.refusal);
      if (refusal === "unchecked") await noteProblem(instance.install, "login_unchecked");

      return { ok: false, refusal };
    },
    entered: instance.entered,
    base: "",
    client: CLIENT_FILES,
    domain: instance.domain,
    follow: instance.follow,
    endLogins: instance.endLogins,
    signOut: LOGOUT_PATH,
    rules: instance.rules,
    freeLimits: FREE_LIMITS,
    usage: instance.usage,
    update: instance.updating.self,
    jobs: instance.jobs,
    counters: instance.counters,
    visitorOf: (asked) => visitorKey(clientAddress(asked.headers), held.visitorSecret, now),
  });

  try {
    return await dashboard.fetch(request, laterOf(open));
  } finally {
    await meter.settle().catch((error: unknown) => logFault("the day's count of writes to the bucket was not written", error));
  }
}

/**
 * The admin hostname: an open path is answered by its own piece, which checks who asks by itself, and every other path by the dashboard.
 *
 * @param open - what holds the invocation open after its answer, for the work the API and the dashboard hold no answer for
 */
async function answerAdmin(request: Request, instance: Instance, ways: Ways, open: ExecutionContext | undefined): Promise<Response> {
  const { pathname } = new URL(request.url);
  const path = INSTALL_OBJECTS.openPaths.find((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
  if (path !== undefined) return OPEN[path](request, instance, ways, open);

  return answerDashboard(request, instance, await ways.held(FRESH), open);
}

/** Run the scheduled sweep of a started instance, and note a run that failed. A Worker with nothing set has no site to sweep; any other start that failed is logged by what stopped it, and thrown, after the install went back where it may. */
async function sweep(started: Started, latest: Outside["latest"], wentBack: WentBack): Promise<void> {
  if (started.ok) {
    return runSweep(started.instance.install, latest, started.instance).catch(async (error: unknown) => {
      await noteProblem(started.instance.install, "sweep_failed", error);

      throw error;
    });
  }

  const { failure } = started;
  if (failure.kind === "unset") return;

  if (failure.kind === "failed") await wentBack(failure);

  console.error(`poplin: the sweep did not run. ${failureText(failure)}`);

  throw new Error(SWEEP_FAILED);
}

/** One scheduled run, from the start of its instance. Cloudflare writes what a run throws into its log, message and all, with its places mapped to the source, so a run that failed throws its fault: fixed words and the places of what was caught. */
async function scheduledRun(starting: () => Promise<Started>, latest: Outside["latest"], wentBack: WentBack): Promise<void> {
  try {
    await sweep(await starting(), latest, wentBack);
  } catch (error) {
    throw faultOf(SWEEP_FAILED, error);
  }
}

/**
 * Answer a request that failed, and note the failure where an install was reached and its database may still take a note.
 *
 * @param failed - the clock's time, and the install the instance last answered from, if it has started
 */
async function answerFailure(request: Request, env: Bindings, error: unknown, failed: { readonly now: number; readonly noting: Pick<Install, "database" | "now"> | undefined }): Promise<Response> {
  logFault("a request failed", error);
  if (error instanceof AllowanceSpent) return answerSpent(request, env, error, failed.now);

  if (failed.noting !== undefined) await noteProblem(failed.noting, "request_failed", error);

  return plain(request, 503, TRY_AGAIN);
}

/** What the instance is given, with the runtime's own clock and `fetch` wherever a part is left out. */
function outsideOf(given: Partial<Outside>): Outside {
  return {
    now: given.now ?? Date.now,
    fetch: given.fetch ?? ((url, init) => fetch(url, init)),
    cloudflare: given.cloudflare,
    latest: given.latest ?? { fetch: (address, init) => fetch(address, init) },
  };
}

/**
 * Make the handlers of one Worker instance.
 *
 * @param given - the clock, the fetch of the Access keys, the fetch of a repair's calls to Cloudflare, and the asking for the newest version; the runtime's own when absent
 * @param starting - makes an instance ready from the Worker's bindings; the Worker's own way when absent
 * @returns `fetch`, which never throws, and `scheduled`, which throws in fixed words when the sweep could not run. A request or a sweep that failed is noted as a problem of the install, where its database still takes a note
 */
export function createWorker(given: Partial<Outside> = {}, starting: typeof startInstance = startInstance): Handlers {
  const outside = outsideOf(given);
  let started: Promise<Started> | undefined;
  // A read that fails means the install may have lost its settings or its key, so the instance starts again from its bindings.
  const { held, ofSite } = createHolding(outside.now, () => {
    started = undefined;
  });
  let noting: Pick<Install, "database" | "now"> | undefined;
  let goneBack: ReturnType<WentBack> | undefined;

  // Asked of Cloudflare once for the instance: every later start that fails the same way is answered from that one try.
  const wentBack: WentBack = (failure) => {
    goneBack ??= failure.back().catch(() => undefined);

    return goneBack;
  };

  async function attempt(env: Bindings): Promise<Started> {
    try {
      const made = await starting(env, outside, visitorOf);
      if (made.ok) return made;

      const went = made.failure.kind === "failed" ? await wentBack(made.failure) : undefined;
      if (went === undefined) started = undefined;

      return made;
    } catch (error) {
      started = undefined;

      throw error;
    }
  }

  function start(env: Bindings): Promise<Started> {
    started ??= attempt(env);

    return started;
  }

  // The API counts a computer that logs in by the same key a site counts its visitors by, under the secret a site request trusts.
  async function visitorOf(request: Request, database: Database): Promise<string> {
    const { visitorSecret } = await held(database, SETTINGS_LIFETIME_MS);

    return visitorKey(clientAddress(request.headers), visitorSecret, outside.now());
  }

  async function answer(request: Request, env: Bindings, open: ExecutionContext | undefined): Promise<Response> {
    const made = await start(env);
    if (!made.ok) {
      const { failure } = made;

      return failure.kind === "unset" ? plain(request, 503, NOT_FINISHED) : failureAnswer(request, failure, wentBack);
    }

    const { instance } = made;
    noting = instance.install;
    const { hostname } = new URL(request.url);
    const { database } = instance.install;
    const ways: Ways = { held: (lifetime) => held(database, lifetime), siteHeld: ofSite(database) };
    const part = instance.hosts.partOf(hostname);
    if (part === "site") return answerSite(request, instance, ways.siteHeld);

    return answerAdmin(request, instance, ways, open);
  }

  return {
    async fetch(request, env, open: ExecutionContext | undefined) {
      try {
        // Before the instance starts: a request over plain http reads nothing of the install.
        return toHttps(request) ?? (await answer(request, env, open));
      } catch (error) {
        return answerFailure(request, env, error, { now: outside.now(), noting });
      }
    },

    async scheduled(_controller, env) {
      await scheduledRun(() => start(env), outside.latest, wentBack);
    },

    starting: start,
  };
}

/** The one Worker of this module: its requests, its scheduled runs, and the steps of its jobs share one started instance. */
const WORKER = createWorker();

/** The Workflow of the install's jobs, under the class name wrangler.jsonc binds as `JOBS`. */
export const PoplinJobs = jobsEntrypoint(WORKER.starting);

export default { fetch: WORKER.fetch, scheduled: WORKER.scheduled } satisfies ExportedHandler<Bindings>;
