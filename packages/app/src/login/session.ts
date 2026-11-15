// The session cookie: written once after a login, read on every request after it.
//
// It binds an email, its issue time, and its end time under the install's signing key, and nothing else: no address, no browser, no Access token.
// It names no domain, so a browser sends it to the hostname that set it and to no other: the dashboard's.
// Its name starts with `__Host-`, which a browser takes only from the hostname itself: no site of the same domain can set or replace it.
// A new signing key ends every session at once.

import { buildSession, verifySession } from "@poplin/core/src/auth/cookie";
import { isLogin, type Login, type Logins } from "@poplin/core/src/auth/logins";
import { serialize } from "hono/utils/cookie";

const COOKIE_NAME = "__Host-poplin-session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Why a request carries no session. `several` is more than one cookie of the name; `not-a-login` is a genuine cookie whose email has left the logins. */
type SessionRefusal = "missing" | "several" | "malformed" | "bad-signature" | "expired" | "not-a-login";

/** The request's headers; `get` answers `null` for an absent one, as `Headers` does. */
export interface RequestHeaders {
  readonly get: (name: string) => string | null;
}

type CheckedSession = { readonly ok: true; readonly value: Login } | { readonly ok: false; readonly refusal: SessionRefusal };

/** What a new session cookie is made from. */
interface NewSession {
  /** Who logged in. */
  readonly email: Login;

  /** The install's signing key, from core's `importSessionKey`. */
  readonly key: CryptoKey;

  /** The time, in whole milliseconds since the epoch. */
  readonly now: number;
}

/** What a request's cookie is checked against. */
interface SessionCheck {
  /** The install's signing key. */
  readonly key: CryptoKey;

  /** The emails allowed in now. */
  readonly logins: Logins;

  /** The time, in milliseconds since the epoch. */
  readonly now: number;
}

/** Every value the header holds under the cookie's name. Only a space or a tab around a pair is dropped: any other character before the name makes it another name, which a site of the same domain can set. */
function valuesOf(header: string): string[] {
  const prefix = `${COOKIE_NAME}=`;

  return header
    .split(";")
    .map((pair) => pair.replace(/^[ \t]+|[ \t]+$/g, ""))
    .filter((pair) => pair.startsWith(prefix))
    .map((pair) => pair.slice(prefix.length));
}

/**
 * Build the `Set-Cookie` value that starts a session of 30 days.
 *
 * @returns the cookie with `Secure; HttpOnly; SameSite=Lax; Path=/` and no `Domain`, as its `__Host-` name needs
 */
export async function mintSessionCookie(session: NewSession): Promise<string> {
  const value = await buildSession({ email: session.email, issuedAt: session.now, maxAgeMs: MAX_AGE_SECONDS * 1000, key: session.key });

  return serialize(COOKIE_NAME, value, { secure: true, httpOnly: true, sameSite: "Lax", path: "/", maxAge: MAX_AGE_SECONDS });
}

/**
 * Decide who a request's session cookie names.
 *
 * @returns the email, when the one cookie is signed under the key, under 30 days old, and still in the logins; otherwise why it failed. A request with two cookies of the name is refused whole
 */
export async function readSession(headers: RequestHeaders, check: SessionCheck): Promise<CheckedSession> {
  const [value, ...others] = valuesOf(headers.get("Cookie") ?? "");
  if (value === undefined) return { ok: false, refusal: "missing" };

  // A browser holds one cookie of this name for the dashboard, so a second one is not the browser's own.
  if (others.length > 0) return { ok: false, refusal: "several" };

  const session = await verifySession(value, { key: check.key, now: check.now });
  if (!session.ok) return session;

  if (!isLogin(check.logins, session.value)) return { ok: false, refusal: "not-a-login" };

  return session;
}
