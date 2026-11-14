// The login itself: a request Cloudflare Access let through becomes the owner's session, or a refusal.
//
//   the Access token, verified  ->  its email, in the logins  ->  the session cookie and the path to go back to

import { isLogin, type Login, type Logins } from "@poplin/core/src/auth/logins";
import { type AccessCheck, type RequestHeaders, type TokenRefusal, verifyAccessToken } from "./access-token";
import type { Hostname } from "../cloudflare/hostname";
import { safeReturnPath } from "./return-path";
import { mintSessionCookie } from "./session";

/** Why a request did not become a session: the token's own refusals, or `not-a-login` for a genuine token whose email is not listed. */
type LoginRefusal = TokenRefusal | "not-a-login";

/** A started session, or why there is none. */
type LoginOutcome =
  | { readonly ok: true; readonly email: Login; readonly setCookie: string; readonly location: string }
  | { readonly ok: false; readonly refusal: LoginRefusal };

/** What a login is decided against. `access.now` is also the session's issue time. */
interface LoginCheck {
  /** The team's keys, the application's audience tag, and the time in whole milliseconds. */
  readonly access: AccessCheck;

  /** The emails allowed in. */
  readonly logins: Logins;

  /** The install's signing key, from core's `importSessionKey`. */
  readonly sessionKey: CryptoKey;

  /** The parent domain the cookie is set on; absent, the cookie stays on the dashboard's hostname. */
  readonly cookieDomain?: Hostname;

  /** Where the visitor asked to go back to, untrusted and decoded from the query once. */
  readonly returnTo?: string | null;
}

/**
 * Decide whether a request to the login path starts a session.
 *
 * @returns the `Set-Cookie` value and a `Location` on the dashboard's own origin, or the refusal; never throws
 */
export async function logIn(headers: RequestHeaders, check: LoginCheck): Promise<LoginOutcome> {
  const email = await verifyAccessToken(headers, check.access);
  if (!email.ok) return email;

  if (!isLogin(check.logins, email.value)) return { ok: false, refusal: "not-a-login" };

  const setCookie = await mintSessionCookie({ email: email.value, key: check.sessionKey, now: check.access.now, domain: check.cookieDomain });

  return { ok: true, email: email.value, setCookie, location: safeReturnPath(check.returnTo) };
}
