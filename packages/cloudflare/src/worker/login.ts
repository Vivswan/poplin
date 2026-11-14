// The login path. Cloudflare Access stands in front of it at the edge; the token Access puts on the request is checked here all the same.
//
//   the Access token  ->  an email in the logins  ->  the session cookie on the install's domain, and the way back

import { logIn } from "@poplin/app/src/login/login";
import type { Held } from "./held";
import type { Instance } from "./start";
import { plain } from "./util";

/** The one method a login is made with: Access sends the person on with a `GET`. */
const METHOD = "GET";

/** The query key that names where the person came from. */
const RETURN_KEY = "return";

/**
 * Answer a request to the login path.
 *
 * @returns 302 with the session cookie, to the dashboard or back to the site the person came from; 403 for a request Access did not sign for a listed email; 503 while the team's keys cannot be had
 * @throws whatever the database rejects with while the login is written to the audit log
 */
export async function answerLogin(request: Request, instance: Instance, held: Held): Promise<Response> {
  if (request.method !== METHOD) return plain(request, 405, "Method not allowed", { Allow: METHOD });

  const now = instance.install.now();
  const outcome = await logIn(request.headers, {
    identify: instance.identify,
    logins: held.logins,
    sessionKey: held.sessionKey,
    now,
    addresses: instance.addresses,
    // The parent domain, so the site hostnames receive the cookie too.
    cookieDomain: instance.layout.domain,
    returnTo: new URL(request.url).searchParams.get(RETURN_KEY),
  });

  if (!outcome.ok && outcome.refusal === "keys-unavailable") return plain(request, 503, "The login cannot be checked right now. Try again.", { "Retry-After": "60" });

  if (!outcome.ok) {
    console.warn(`poplin: a login was refused: ${outcome.refusal}`);

    return plain(request, 403, "Forbidden");
  }

  await instance.install.database.appendAudit({ action: "login", detail: {} }, { by: outcome.email, at: now });

  return new Response(null, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", Location: outcome.location, "Set-Cookie": outcome.setCookie } });
}
