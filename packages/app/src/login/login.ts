// The login itself: whoever the provider's check says a request is from becomes the owner's session, or a refusal.
//
//   the provider's verdict: an email  ->  in the logins  ->  the session cookie and the place to go back to

import { isLogin, type Login, type Logins } from "@poplin/core/src/auth/logins";
import type { Hostname } from "@poplin/core/src/names/hostname";
import type { SiteAddresses } from "../sites/addresses";
import { safeReturn } from "./return-path";
import { mintSessionCookie, type RequestHeaders } from "./session";

/**
 * A provider's login: who a request is from.
 *
 * @param now - the time, in milliseconds since the epoch
 * @returns the email the provider verified, in normal form, or the provider's own refusal; it never throws
 */
export type Identify<Refusal extends string> = (headers: RequestHeaders, now: number) => Promise<{ readonly ok: true; readonly value: Login } | { readonly ok: false; readonly refusal: Refusal }>;

/** A started session, or why there is none: the provider's refusal, or `not-a-login` for a verified email that is not listed. */
type LoginOutcome<Refusal extends string> =
  | { readonly ok: true; readonly email: Login; readonly setCookie: string; readonly location: string }
  | { readonly ok: false; readonly refusal: Refusal | "not-a-login" };

/** What a login is decided against. */
interface LoginCheck<Refusal extends string> {
  /** The provider's login. */
  readonly identify: Identify<Refusal>;

  /** The emails allowed in. */
  readonly logins: Logins;

  /** The install's signing key, from core's `importSessionKey`. */
  readonly sessionKey: CryptoKey;

  /** The time in whole milliseconds since the epoch, which is also the session's issue time. */
  readonly now: number;

  /** The install's address layout, which says whether a return leads to one of its sites. */
  readonly addresses: Pick<SiteAddresses, "resolve">;

  /** The parent domain the cookie is set on; absent, the cookie stays on the dashboard's hostname. */
  readonly cookieDomain?: Hostname;

  /** Where the visitor asked to go back to, untrusted and decoded from the query once. */
  readonly returnTo?: string | null;
}

/**
 * Decide whether a request to the login path starts a session.
 *
 * @returns the `Set-Cookie` value and a `Location` that is a dashboard path or an address of the install's own sites, or the refusal; throws only what the provider's login throws
 */
export async function logIn<Refusal extends string>(headers: RequestHeaders, check: LoginCheck<Refusal>): Promise<LoginOutcome<Refusal>> {
  const email = await check.identify(headers, check.now);
  if (!email.ok) return email;

  if (!isLogin(check.logins, email.value)) return { ok: false, refusal: "not-a-login" };

  const setCookie = await mintSessionCookie({ email: email.value, key: check.sessionKey, now: check.now, domain: check.cookieDomain });

  return { ok: true, email: email.value, setCookie, location: safeReturn(check.returnTo, check.addresses) };
}
