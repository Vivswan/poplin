// The entry's answer once D1's allowance for the day is used up: the same refusal in the form each address speaks.
//
//   a site's hostname            the small page of a paused site, which a cache may keep for a minute
//   /setup/api/...               the setup's JSON refusal to a program's run, on whichever hostname
//   <admin hostname>/api/...     the API's JSON refusal, code `allowance_spent`
//   <admin hostname>/...         the dashboard's notice, which names what ran out

import { spentRefusal } from "@poplin/app/src/api/respond";
import { spentNotice } from "@poplin/app/src/dashboard/dashboard";
import { spentRun } from "@poplin/app/src/dashboard/domain/setup";
import { pausedResponse } from "@poplin/app/src/sites/paused";
import type { AllowanceSpent } from "@poplin/core/src/database/driver";
import { readZoneBinding } from "../zone/zone-binding";
import type { Bindings } from "./bindings";

/** Where the API answers, and everything below it. */
const API_PATH = "/api";

/** Where the setup page takes a program's run, and everything below it. */
const SETUP_RUNS = "/setup/api/";

function answerOf(url: URL, env: Bindings, spent: AllowanceSpent, now: number): Response {
  if (url.pathname.startsWith(SETUP_RUNS)) return spentRun(now);

  const zone = readZoneBinding(env.ZONE);
  if (!zone.ok || url.hostname !== zone.value.adminHostname) return pausedResponse(now);

  if (url.pathname === API_PATH || url.pathname.startsWith(`${API_PATH}/`)) return spentRefusal(spent, now);

  return spentNotice(spent, now);
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
