// The Worker: every request and every scheduled run enters here.
//
//   <admin hostname>/api and below   the API, which checks the bearer token itself
//   <admin hostname>/login           the login, which checks the Access token itself
//   <admin hostname>/...             the dashboard, which checks the session cookie itself
//   any other hostname               the limits, then serving; one that is no site's gets serving's own 404
//
// An instance starts on its first request, and every request that arrives meanwhile waits on that one start.
// Only a start that succeeded is kept. A failed one is answered to the requests that waited on it, and the next request starts again.
//
// A site request trusts settings and keys read up to a minute ago. The login and the dashboard read them anew,
// so a removed login or "sign everyone out" ends a dashboard session at once and a site's within the minute.

import { createDashboard } from "@poplin/app/src/dashboard/dashboard";
import { readSession } from "@poplin/app/src/login/session";
import { INSTALL_OBJECTS } from "../zone/install-objects";
import type { Bindings } from "./bindings";
import { type Held, readHeld } from "./held";
import { answerLogin } from "./login";
import { answerSite } from "./site";
import { type Failure, type Instance, type Outside, type Started, startInstance } from "./start";
import { type Place, runSweep } from "./sweep";
import { plain } from "./util";

/** How long a site request trusts the settings and the keys an instance read. */
const SETTINGS_LIFETIME_MS = 60_000;

/** The login and the dashboard trust no earlier read. */
const FRESH = 0;

/** Where the API answers, and everything below it. */
const API_PATH = "/api";

/** The answer to a request that met a failure of the database or the bucket. */
const TRY_AGAIN = "Something went wrong. Try again.";

/** What stopped an instance, in a sentence for whoever runs the install. It names a binding and never a value of one. */
function failureText(failure: Failure): string {
  if (failure.kind === "binding") return `This install is set up wrong: its ${failure.binding} binding is refused (${failure.refusal}).`;

  if (failure.kind === "newer") return "This install's database is newer than its code: update poplin.";

  return "This install's database could not be brought up to date. Try again.";
}

function failureAnswer(request: Request, failure: Failure): Response {
  if (failure.kind === "binding") return plain(request, 500, failureText(failure));

  return plain(request, 503, failureText(failure));
}

/** Where the dashboard answers: every path of the admin hostname that is neither the API nor the login. */
function answerDashboard(request: Request, instance: Instance, held: Held): Promise<Response> {
  const dashboard = createDashboard({
    install: instance.install,
    readSession: (headers) => readSession(headers, { key: held.sessionKey, logins: held.logins, now: instance.install.now() }),
    addresses: instance.addresses,
    csrfSecret: held.formsSecret,
  });

  return dashboard.fetch(request);
}

/**
 * Make the handlers of one Worker instance.
 *
 * @param given - the clock and the fetch of the Access keys; the runtime's own when absent
 * @returns `fetch`, which never throws, and `scheduled`, which throws when the sweep could not run
 */
export function createWorker(given: Partial<Outside> = {}): Required<Pick<ExportedHandler<Bindings>, "fetch" | "scheduled">> {
  const outside: Outside = { now: given.now ?? Date.now, fetch: given.fetch ?? ((url, init) => fetch(url, init)) };
  let starting: Promise<Started> | undefined;
  let holding: { readonly at: number; readonly value: Promise<Held> } | undefined;
  let sweepFrom: Place | undefined;

  async function attempt(env: Bindings): Promise<Started> {
    try {
      const started = await startInstance(env, outside);
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
  async function read(instance: Instance): Promise<Held> {
    try {
      return await readHeld(instance.install.database);
    } catch (error) {
      starting = undefined;
      holding = undefined;

      throw error;
    }
  }

  function held(instance: Instance, lifetime: number): Promise<Held> {
    const at = outside.now();
    if (holding === undefined || at - holding.at >= lifetime) holding = { at, value: read(instance) };

    return holding.value;
  }

  async function answer(request: Request, env: Bindings): Promise<Response> {
    const started = await start(env);
    if (!started.ok) return failureAnswer(request, started.failure);

    const { instance } = started;
    const url = new URL(request.url);
    if (url.hostname !== instance.layout.adminHostname) return answerSite(request, instance, await held(instance, SETTINGS_LIFETIME_MS));

    if (url.pathname === API_PATH || url.pathname.startsWith(`${API_PATH}/`)) return instance.api.fetch(request);

    if (url.pathname === INSTALL_OBJECTS.loginPath) return answerLogin(request, instance, await held(instance, FRESH));

    return answerDashboard(request, instance, await held(instance, FRESH));
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

    async scheduled(controller, env) {
      const started = await start(env);
      if (!started.ok) throw new Error(`the sweep did not run. ${failureText(started.failure)}`);

      sweepFrom = await runSweep(started.instance.install, controller.scheduledTime, sweepFrom);
    },
  };
}

export default createWorker();
