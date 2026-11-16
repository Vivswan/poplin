// The Worker: every request and every scheduled run enters here.
//
//   <admin hostname>/api and below   the API, which checks the bearer token itself; its two login routes take none and are counted by visitor
//   <admin hostname>/login           the login, which checks the Access token itself
//   <admin hostname>/setup and below the setup page, which answers only until somebody has logged in
//   <admin hostname>/...             the dashboard, which checks the session cookie itself
//   the Worker's workers.dev address the setup page and nothing else of the install: it is the one address that resolves before setup made the records
//   any other hostname               the Access token under `p`, the limits, then serving; one that is no site's gets serving's own 404
//
// An instance starts on its first request, and every request that arrives meanwhile waits on that one start.
// Only a start that succeeded is kept. A failed one is answered to the requests that waited on it, and the next request starts again.
//
// A site request trusts settings and logins read up to a minute ago. The login and the dashboard read them anew on every request,
// so a removed login loses the dashboard at once and the private sites within the minute. A dashboard request that only reads uses that one read for all it answers.
// The session cookie is the dashboard's alone: "sign everyone out" ends the dashboard's sessions, and a private site's login is Access's own.

import { createConsole } from "@poplin/app/src/console/console";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import { readSession } from "@poplin/app/src/login/session";
import { toHttps } from "@poplin/app/src/transport/to-https";
import type { Database } from "@poplin/core/src/database/database";
import { AllowanceSpent } from "@poplin/core/src/database/driver";
import { meterStore } from "@poplin/core/src/storage/metered";
import { clientAddress } from "../limits/client-address";
import { FREE_LIMITS } from "../limits/free-limits";
import { INSTALL_OBJECTS } from "../zone/install-objects";
import type { Bindings } from "./bindings";
import { CLIENT_FILES } from "./client-files";
import { createHolding, type Held, SETTINGS_LIFETIME_MS, type SiteHeld } from "./held";
import { answerLogin } from "./login";
import { answerSite } from "./site";
import { answerFirstSetup, answerSetup, isSetupPath } from "./setup";
import { answerSpent } from "./spent";
import { type Failure, type Instance, type Outside, type Started, startInstance } from "./start";
import { runSweep } from "./sweep";
import { plain } from "./util";

/** The login and the dashboard trust no earlier read. */
const FRESH = 0;

/** Where the API answers, and everything below it. */
const API_PATH = "/api";

/** The answer to a request that met a failure of the database or the bucket. */
const TRY_AGAIN = "Something went wrong. Try again.";

/** What the hostname of a Worker's own address ends in. Cloudflare gives every Worker one, whatever its routes. */
const OWN_ADDRESS = ".workers.dev";

/** The answer of an install whose database another build of poplin made: by a schema step that was not this code's, or with settings this code does not read. */
const MADE_BY_ANOTHER_BUILD = "This install's database was made by another build of poplin, so its records are not the ones this build reads. Deploy the build that made it, or delete the database and poplin makes it anew.";

/** The setup page, for a redirect from the Worker's own address. */
const SETUP = "/setup";

/** Where the variables of an install come from, for a person whose Worker lost or mistyped one. */
const SET_THEM = "Setup writes them, and so does the OpenTofu module. In the Cloudflare dashboard they are under Workers & Pages, this Worker, Settings, Variables and Secrets.";

/** What a request is answered through: the settings its instance holds, read no longer ago than `lifetime` milliseconds, the same for a site request, and whether the setup page is open. */
interface Ways {
  readonly held: (lifetime: number) => Promise<Held>;
  readonly siteHeld: SiteHeld;
  readonly setupOpen: () => Promise<boolean>;
}

/** A start that failed, as apart from a Worker with nothing set, which is no failure. */
type Stopped = Exclude<Failure, { readonly kind: "unset" }>;

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

function failureAnswer(request: Request, failure: Stopped): Response {
  return plain(request, 503, failureText(failure));
}

/** Where the dashboard answers: every path of the admin hostname that is neither the API nor the login. */
async function answerDashboard(request: Request, instance: Instance, held: Held): Promise<Response> {
  const now = instance.install.now();
  // As the API does: every listing of the bucket this request makes is counted against the day, and written down once.
  const meter = meterStore(instance.install.store, { database: instance.install.database, now: instance.install.now });
  // A request that changes nothing takes the settings its session was just checked against. A change reads them itself, inside its own step.
  const known = request.method === "GET" ? { knownSettings: held.settings } : {};
  const dashboard = createConsole({
    install: { ...instance.install, store: meter.store, ...known },
    version: instance.version,
    readSession: (headers) => readSession(headers, { key: held.sessionKey, logins: held.logins, now }),
    loginPath: INSTALL_OBJECTS.loginPath,
    base: "",
    client: CLIENT_FILES,
    domain: instance.domain,
    freeLimits: FREE_LIMITS,
    rebuild: instance.rebuilding,
    counters: instance.counters,
    visitorOf: (asked) => visitorKey(clientAddress(asked.headers), held.visitorSecret, now),
  });

  try {
    return await dashboard.fetch(request);
  } finally {
    await meter.settle().catch((error: unknown) => console.error("poplin: the day's count of writes to the bucket was not written", error));
  }
}

/** The Worker's own address answers setup alone: the page itself, the way to it from any other path while it is open, and nothing after. */
async function answerOwnAddress(request: Request, instance: Instance, ways: Ways): Promise<Response> {
  if (isSetupPath(new URL(request.url).pathname)) return answerSetup(request, instance, await ways.held(FRESH), ways.setupOpen);

  if (await ways.setupOpen()) return new Response(null, { status: 302, headers: { "Cache-Control": "no-store", Location: SETUP } });

  return plain(request, 404, "Not found.");
}

/** The admin hostname: the API, the login, the setup page, and the dashboard, each of which checks who asks by itself. */
async function answerAdmin(request: Request, instance: Instance, ways: Ways): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === API_PATH || pathname.startsWith(`${API_PATH}/`)) return instance.api.fetch(request);

  if (pathname === INSTALL_OBJECTS.loginPath) return answerLogin(request, instance, await ways.held(FRESH));

  if (isSetupPath(pathname)) return answerSetup(request, instance, await ways.held(FRESH), ways.setupOpen);

  return answerDashboard(request, instance, await ways.held(FRESH));
}

/** Run the scheduled sweep of a started instance. A Worker with nothing set has no site to sweep; any other start that failed is thrown. */
async function sweep(started: Started, latest: Outside["latest"]): Promise<void> {
  if (started.ok) return runSweep(started.instance.install, latest, started.instance);

  const { failure } = started;
  if (failure.kind !== "unset") throw new Error(`the sweep did not run. ${failureText(failure)}`);
}

/** What the instance is given, with the runtime's own clock and `fetch` wherever a part is left out. */
function outsideOf(given: Partial<Outside>): Outside {
  return {
    now: given.now ?? Date.now,
    fetch: given.fetch ?? ((url, init) => fetch(url, init)),
    cloudflare: given.cloudflare,
    latest: given.latest ?? { fetch: (address, init) => fetch(address, init) },
    rebuild: given.rebuild ?? ((address, init) => fetch(address, init)),
  };
}

/**
 * Make the handlers of one Worker instance.
 *
 * @param given - the clock, the fetch of the Access keys, the fetch of setup's calls to Cloudflare, the asking for the newest version, and the fetch that starts a build; the runtime's own when absent
 * @returns `fetch`, which never throws, and `scheduled`, which throws when the sweep could not run
 */
export function createWorker(given: Partial<Outside> = {}): Required<Pick<ExportedHandler<Bindings>, "fetch" | "scheduled">> {
  const outside = outsideOf(given);
  let starting: Promise<Started> | undefined;
  let loggedInOnce = false;
  // A read that fails means the install may have lost its settings or its key, so the instance starts again from its bindings.
  const { held, ofSite } = createHolding(outside.now, () => {
    starting = undefined;
  });

  async function attempt(env: Bindings): Promise<Started> {
    try {
      const started = await startInstance(env, outside, visitorOf);
      if (!started.ok) starting = undefined;

      return started;
    } catch (error) {
      starting = undefined;

      throw error;
    }
  }

  function start(env: Bindings): Promise<Started> {
    starting ??= attempt(env);

    return starting;
  }

  // The API counts a computer that logs in by the same key a site counts its visitors by, under the secret a site request trusts.
  async function visitorOf(request: Request, database: Database): Promise<string> {
    const { visitorSecret } = await held(database, SETTINGS_LIFETIME_MS);

    return visitorKey(clientAddress(request.headers), visitorSecret, outside.now());
  }

  // A login is never undone, so an instance that saw one asks the database no more.
  async function setupOpen(database: Database): Promise<boolean> {
    if (!loggedInOnce) loggedInOnce = await database.hasLoggedIn();

    return !loggedInOnce;
  }

  async function answer(request: Request, env: Bindings): Promise<Response> {
    const started = await start(env);
    if (!started.ok) {
      const { failure } = started;

      return failure.kind === "unset" ? answerFirstSetup(request, failure.unset, outside.now) : failureAnswer(request, failure);
    }

    const { instance } = started;
    const { hostname } = new URL(request.url);
    const { database } = instance.install;
    const ways: Ways = { held: (lifetime) => held(database, lifetime), siteHeld: ofSite(database), setupOpen: () => setupOpen(database) };
    if (hostname.endsWith(OWN_ADDRESS)) return answerOwnAddress(request, instance, ways);

    if (hostname !== instance.layout.adminHostname) return answerSite(request, instance, ways.siteHeld);

    return answerAdmin(request, instance, ways);
  }

  return {
    async fetch(request, env) {
      try {
        // Before the instance starts: a request over plain http reads nothing of the install.
        return toHttps(request) ?? (await answer(request, env));
      } catch (error) {
        console.error("poplin: a request failed", error);
        if (error instanceof AllowanceSpent) return answerSpent(request, env, error, outside.now());

        return plain(request, 503, TRY_AGAIN);
      }
    },

    async scheduled(_controller, env) {
      await sweep(await start(env), outside.latest);
    },
  };
}

export default createWorker();
