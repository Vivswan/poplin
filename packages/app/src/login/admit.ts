// Who a request to the dashboard is from: the provider's login checked on the request itself, then its email against the install's users.
//
//   the provider's verdict: an email  ->  one of the users  ->  an admin of the install
//
// Nothing is kept between requests and no cookie is set: a user who was removed is refused on the next request.

import { isLogin, type Login, type Logins } from "@poplin/core/src/auth/logins";
import type { Actor } from "@poplin/core/src/auth/scopes";

/** What a request of a verified email that is no user is refused as. */
const NOT_A_USER = "not-a-user";

/** The request's headers; `get` answers `null` for an absent one, as `Headers` does. */
export interface RequestHeaders {
  readonly get: (name: string) => string | null;
}

/**
 * A provider's login: who a request is from.
 *
 * @param now - the time, in milliseconds since the epoch
 * @returns the email the provider verified, in normal form, and `since`, the moment that login began, in milliseconds since the epoch; or the provider's own refusal. It never throws
 */
export type Identify<Refusal extends string> = (
  headers: RequestHeaders,
  now: number,
) => Promise<{ readonly ok: true; readonly value: Login; readonly since: number } | { readonly ok: false; readonly refusal: Refusal }>;

/** What a request is admitted against. */
interface Admission<Refusal extends string> {
  /** The provider's login. */
  readonly identify: Identify<Refusal>;

  /** The install's users, as they are now. */
  readonly logins: Logins;

  /** The time, in milliseconds since the epoch. */
  readonly now: number;
}

/** Who asks, or why nobody does: the provider's refusal, or `not-a-user` for a verified email that is not one of the users. */
type Admitted<Refusal extends string> =
  | { readonly ok: true; readonly actor: Actor & { readonly holder: Login }; readonly since: number }
  | { readonly ok: false; readonly refusal: Refusal | typeof NOT_A_USER };

/**
 * Decide who a request is from.
 *
 * @returns the user as an admin, which every user of an install is in a browser, with the moment the provider's login began; or the refusal. It throws only what the provider's login throws
 */
export async function admit<Refusal extends string>(headers: RequestHeaders, admission: Admission<Refusal>): Promise<Admitted<Refusal>> {
  const identity = await admission.identify(headers, admission.now);
  if (!identity.ok) return identity;

  if (!isLogin(admission.logins, identity.value)) return { ok: false, refusal: NOT_A_USER };

  return { ok: true, actor: { scope: "admin", holder: identity.value }, since: identity.since };
}
