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
// A site request trusts settings and logins read up to a minute ago. The login and the dashboard read them anew,
// so a removed login loses the dashboard at once and the private sites within the minute.
// The session cookie is the dashboard's alone: "sign everyone out" ends the dashboard's sessions, and a private site's login is Access's own.

import { createDashboard } from "@poplin/app/src/dashboard/dashboard";
import { visitorKey } from "@poplin/app/src/limits/visitor-key";
import { readSession } from "@poplin/app/src/login/session";
import type { Database } from "@poplin/core/src/database/database";
import { clientAddress } from "../limits/client-address";
import { FREE_LIMITS } from "../limits/free-limits";
import { INSTALL_OBJECTS } from "../zone/install-objects";
import type { Bindings } from "./bindings";
import { type Held, readHeld } from "./held";
import { answerLogin } from "./login";
import { answerSite } from "./site";
import { answerFirstSetup, answerSetup, isSetupPath } from "./setup";
import { type Failure, type Instance, type Outside, type Started, startInstance } from "./start";
import { runSweep } from "./sweep";
import { plain } from "./util";

/** How long a site request trusts the settings and the logins an instance read. */
const SETTINGS_LIFETIME_MS = 60_000;

/** The login and the dashboard trust no earlier read. */
const FRESH = 0;

/** Where the API answers, and everything below it. */
const API_PATH = "/api";

/** The answer to a request that met a failure of the database or the bucket. */
const TRY_AGAIN = "Something went wrong. Try again.";

/** What the hostname of a Worker's own address ends in. Cloudflare gives every Worker one, whatever its routes. */
const OWN_ADDRESS = ".workers.dev";

/** The setup page, for a redirect from the Worker's own address. */
const SETUP = "/setup";

/** Where the variables of an install come from, for a person whose Worker lost or mistyped one. */
const SET_THEM = "Setup writes them, and so does the OpenTofu module. In the Cloudflare dashboard they are under Workers & Pages, this Worker, Settings, Variables and Secrets.";

/** What a request is answered through: the settings its instance holds, read no longer ago than `lifetime` milliseconds, and whether the setup page is open. */
interface Ways {
  readonly held: (lifetime: number) => Promise<Held>;
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

  return "This install's database could not be brought up to date. Try again.";
}

function failureAnswer(request: Request, failure: Stopped): Response {
  return plain(request, 503, failureText(failure));
}

/** Where the dashboard answers: every path of the admin hostname that is neither the API nor the login. */
function answerDashboard(request: Request, instance: Instance, held: Held): Promise<Response> {
  const now = instance.install.now();
  const dashboard = createDashboard({
    install: instance.install,
    readSession: (headers) => readSession(headers, { key: held.sessionKey, logins: held.logins, now }),
    loginPath: INSTALL_OBJECTS.loginPath,
    csrfSecret: held.formsSecret,
    domain: instance.domain,
    freeLimits: FREE_LIMITS,
    counters: instance.counters,
    visitorOf: (asked) => visitorKey(clientAddress(asked.headers), held.visitorSecret, now),
  });

  return dashboard.fetch(request);
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
async function sweep(started: Started): Promise<void> {
  if (started.ok) return runSweep(started.instance.install);

  const { failure } = started;
  if (failure.kind !== "unset") throw new Error(`the sweep did not run. ${failureText(failure)}`);
}

/**
 * Make the handlers of one Worker instance.
 *
 * @param given - the clock, the fetch of the Access keys, and the fetch of setup's calls to Cloudflare; the runtime's own when absent
 * @returns `fetch`, which never throws, and `scheduled`, which throws when the sweep could not run
 */
export function createWorker(given: Partial<Outside> = {}): Required<Pick<ExportedHandler<Bindings>, "fetch" | "scheduled">> {
  const outside: Outside = { now: given.now ?? Date.now, fetch: given.fetch ?? ((url, init) => fetch(url, init)), cloudflare: given.cloudflare };
  let starting: Promise<Started> | undefined;
  let holding: { readonly at: number; readonly value: Promise<Held> } | undefined;
  let loggedInOnce = false;

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

  // A read that fails means the install may have lost its settings or its key, so the instance starts again from its bindings.
  async function read(database: Database): Promise<Held> {
    try {
      return await readHeld(database);
    } catch (error) {
      starting = undefined;
      holding = undefined;

      throw error;
    }
  }

  function held(database: Database, lifetime: number): Promise<Held> {
    const at = outside.now();
    if (holding === undefined || at - holding.at >= lifetime) holding = { at, value: read(database) };

    return holding.value;
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
    const ways: Ways = { held: (lifetime) => held(database, lifetime), setupOpen: () => setupOpen(database) };
    if (hostname.endsWith(OWN_ADDRESS)) return answerOwnAddress(request, instance, ways);

    if (hostname !== instance.layout.adminHostname) return answerSite(request, instance, await ways.held(SETTINGS_LIFETIME_MS));

    return answerAdmin(request, instance, ways);
  }

  return {
    async fetch(request, env) {
      try {
        return await answer(request, env);
      } catch (error) {
        console.error("poplin: a request failed", error);

        return plain(request, 503, TRY_AGAIN);
      }
    },

    async scheduled(_controller, env) {
      await sweep(await start(env));
    },
  };
}

export default createWorker();
