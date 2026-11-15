// The scheme one browser shows the dashboard in: the system's own, or the one its cookie names.

import { parse, serialize } from "hono/utils/cookie";

/** The cookie that holds the choice. It is no secret, so it is kept on a plain connection too. */
export const THEME_COOKIE = "theme";

/** The choices in the order shown, each with its label. The first follows the system. */
export const THEMES = { system: "System", light: "Light", dark: "Dark" } as const;

/** How long a choice is kept, in seconds: a year. */
const KEPT_SECONDS = 365 * 24 * 60 * 60;

/** One choice of scheme. */
export type Theme = keyof typeof THEMES;

function isTheme(name: string | undefined): name is Theme {
  return name !== undefined && Object.hasOwn(THEMES, name);
}

/**
 * Read the scheme a request's cookies name.
 *
 * @param cookie - the `Cookie` header, untrusted
 * @returns the choice, or `system` for no cookie and for any other value
 */
export function themeOf(cookie: string | undefined): Theme {
  const named = parse(cookie ?? "", THEME_COOKIE)[THEME_COOKIE];

  return isTheme(named) ? named : "system";
}

/**
 * Write the cookie that keeps a choice of scheme.
 *
 * @param chosen - what the form named, untrusted; anything but a choice is kept as `system`
 * @returns the value of a `Set-Cookie` header, for every path of the dashboard's hostname
 */
export function themeCookie(chosen: string | undefined): string {
  return serialize(THEME_COOKIE, isTheme(chosen) ? chosen : "system", { path: "/", httpOnly: true, sameSite: "Lax", maxAge: KEPT_SECONDS });
}
