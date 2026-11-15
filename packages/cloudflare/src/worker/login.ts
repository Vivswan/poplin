// The login path. Cloudflare Access stands in front of it at the edge; the token Access puts on the request is checked here all the same.
//
//   the Access token  ->  an email in the logins  ->  the dashboard's session cookie, and the way back to a dashboard path

import { logIn } from "@poplin/app/src/login/login";
import { noteProblem } from "@poplin/core/src/actions/problems";
import type { Login } from "@poplin/core/src/auth/logins";
import type { Database } from "@poplin/core/src/database/database";
import type { Held } from "./held";
import { type Instance, NO_ACCESS } from "./start";
import { plain } from "./util";

/** The one method a login is made with: Access sends the person on with a `GET`. */
const METHOD = "GET";

/** The query key that names where the person came from. */
const RETURN_KEY = "return";

/**
 * Write a login to the audit log.
 *
 * The first entry is what closes the setup page, so a database that refuses it lets nobody in. Every later one is a record alone: a database that refuses it and still reads keeps the person, and the entry is given up with a line in the log.
 *
 * @throws whatever the database rejects the first login's entry with, or the question of whether there was one
 */
async function record(database: Database, email: Login, now: number): Promise<void> {
  try {
    await database.appendAudit({ action: "login", detail: {} }, { by: email, at: now });
  } catch (error) {
    if (!(await database.hasLoggedIn())) throw error;

    console.warn("poplin: a login was not written to the audit log", error);
    await noteProblem({ database, now: () => now }, "login_unwritten", error);
  }
}

/**
 * Answer a request to the login path.
 *
 * @returns 302 with the session cookie of the admin hostname alone, to the dashboard path the person came from; 403 for a request Access did not sign for a listed email; 503 while the team's keys cannot be had, or before setup wrote `ACCESS`
 * @throws whatever the database rejects with while the first login is written to the audit log
 */
export async function answerLogin(request: Request, instance: Instance, held: Held): Promise<Response> {
  if (request.method !== METHOD) return plain(request, 405, "Method not allowed", { Allow: METHOD });

  const now = instance.install.now();
  const outcome = await logIn(request.headers, {
    identify: instance.identify,
    logins: held.logins,
    sessionKey: held.sessionKey,
    now,
    returnTo: new URL(request.url).searchParams.get(RETURN_KEY),
  });

  if (!outcome.ok && outcome.refusal === NO_ACCESS) return plain(request, 503, "The login is not set up yet. Finish the setup of this install first.");

  if (!outcome.ok && outcome.refusal === "keys-unavailable") {
    await noteProblem(instance.install, "login_unchecked");

    return plain(request, 503, "The login cannot be checked right now. Try again.", { "Retry-After": "60" });
  }

  if (!outcome.ok) {
    console.warn(`poplin: a login was refused: ${outcome.refusal}`);

    return plain(request, 403, "Forbidden");
  }

  await record(instance.install.database, outcome.email, now);

  return new Response(null, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Location: outcome.location, "Set-Cookie": outcome.setCookie } });
}
