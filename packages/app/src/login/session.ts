// The session cookie: written once after a login, read on every request after it.
//
// It binds an email and its issue time under the install's signing key, and nothing else: no address, no browser, no Access token.
// It names no domain, so a browser sends it to the hostname that set it and to no other: the dashboard's.
// A new signing key ends every session at once.

import { buildSession, verifySession } from "@poplin/core/src/auth/cookie";
import { isLogin, type Login, type Logins } from "@poplin/core/src/auth/logins";
import { serialize } from "hono/utils/cookie";

const COOKIE_NAME = "__Secure-poplin-session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_CANDIDATES = 8;

/** Why a request carries no session. `not-a-login` is a genuine cookie whose email has left the logins. */
type SessionRefusal = "missing" | "malformed" | "bad-signature" | "expired" | "not-a-login";

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

function candidates(header: string): string[] {
  const prefix = `${COOKIE_NAME}=`;

  return header
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith(prefix))
    .map((pair) => pair.slice(prefix.length))
    .slice(0, MAX_CANDIDATES);
}

async function checkValue(value: string, check: SessionCheck): Promise<CheckedSession> {
  const session = await verifySession(value, { key: check.key, now: check.now, maxAgeMs: MAX_AGE_SECONDS * 1000 });
  if (!session.ok) return session;

  if (!isLogin(check.logins, session.value)) return { ok: false, refusal: "not-a-login" };

  return session;
}

/**
 * Build the `Set-Cookie` value that starts a session of 30 days.
 *
 * @returns the cookie with `Secure; HttpOnly; SameSite=Lax; Path=/` and no `Domain`
 */
export async function mintSessionCookie(session: NewSession): Promise<string> {
  const value = await buildSession({ email: session.email, issuedAt: session.now, key: session.key });

  return serialize(COOKIE_NAME, value, { secure: true, httpOnly: true, sameSite: "Lax", path: "/", maxAge: MAX_AGE_SECONDS });
}

/**
 * Decide who a request's session cookie names.
 *
 * @returns the email, when a cookie is signed under the key, under 30 days old, and still in the logins; otherwise why the first cookie failed
 */
export async function readSession(headers: RequestHeaders, check: SessionCheck): Promise<CheckedSession> {
  let first: CheckedSession | undefined;

  // Another site of the domain can plant a cookie of this name ahead of the real one, so each is tried.
  for (const value of candidates(headers.get("Cookie") ?? "")) {
    const session = await checkValue(value, check);
    if (session.ok) return session;

    first ??= session;
  }

  return first ?? { ok: false, refusal: "missing" };
}
