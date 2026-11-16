// The entry's answer once D1's allowance for the day is used up: the same refusal in the form each address speaks.
//
//   a site's hostname            the small page of a paused site, which a cache may keep for a minute
//   <admin host>/api/...         the API's JSON refusal, code `allowance_spent`
//   <admin host>/...             the dashboard's own answer, which names what ran out: JSON to its client, plain words for a page
//
// The instance may not have started, so what a hostname is of the install is read from the bindings again, by the reader the start uses.
// A Worker with nothing set opens no database, so none of its requests ends here.

import { spentRefusal } from "@poplin/app/src/api/respond";
import { spentAnswer } from "@poplin/app/src/console/spent";
import { pausedResponse } from "@poplin/app/src/sites/paused";
import type { AllowanceSpent } from "@poplin/core/src/database/driver";
import { INSTALL_OBJECTS } from "../install/install-objects";
import type { Bindings } from "./bindings";
import { readHosts } from "./hosts";
import { readOwnWorker } from "./own-worker";

/** Where the API answers, and everything below it. */
const API_PATH = "/api";

function answerOf(url: URL, env: Bindings, spent: AllowanceSpent, now: number): Response {
  const own = readOwnWorker({ accountId: env[INSTALL_OBJECTS.accountBinding], script: env[INSTALL_OBJECTS.workerBinding] });
  const hosts = readHosts(env.ZONE, own.ok ? own.value.script : own.script);
  if (!hosts.ok || hosts.value.partOf(url.hostname) === "site") return pausedResponse(now);

  if (url.pathname === API_PATH || url.pathname.startsWith(`${API_PATH}/`)) return spentRefusal(spent, now);

  return spentAnswer(spent, { path: url.pathname, base: "", now });
}

/**
 * Answer a request that met a database whose allowance for the day is used up.
 *
 * @param now - the clock, in milliseconds since the epoch
 * @returns status 503 with `Retry-After` up to the next midnight UTC; a `HEAD` request gets the headers alone
 */
export function answerSpent(request: Request, env: Bindings, spent: AllowanceSpent, now: number): Response {
  const answer = answerOf(new URL(request.url), env, spent, now);
  if (request.method !== "HEAD") return answer;

  return new Response(null, { status: answer.status, headers: answer.headers });
}
