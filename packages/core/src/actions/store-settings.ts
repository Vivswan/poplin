// The one way an action changes the stored settings: a change of the logins is stored only while it leaves somebody able to log in.
//
// The login page in front of an install keeps a list of its own, which follows the stored logins when the install carries them there or an admin repairs it from the dashboard.
// So an email that was just stored may get nobody in yet, and a list made of such emails alone shuts the dashboard on everyone, the way back included.
//
// One change is made by nobody who is a login: while nobody has ever logged in, no login is known to work, and the first one may have been mistyped.
// `storeFirstLogin` replaces it, for a caller that has proven it may change the install's side at the provider, and for no longer than that.

import * as v from "valibot";

import type { Login } from "../auth/logins";
import type { Actor } from "../auth/scopes";
import { SETTING_VALUES, type SettingValues } from "../records/settings";
import { type Install, type Refused, refuse } from "./records";

/** What reading or changing the settings answers: every setting. */
export const SETTINGS_ANSWER = v.object({ values: SETTING_VALUES });

/** The settings as they are, read or after a change. */
export type Stored = { readonly ok: true } & Readonly<v.InferOutput<typeof SETTINGS_ANSWER>>;

/**
 * Decide whether new logins keep one that works.
 *
 * A login works when the login page is known to let it in: the email of an admin who came through that page to make this change, or, for a change made with a token, any email that was a login before it.
 */
function keepsWorkingLogin(actor: Actor, stored: readonly Login[], next: readonly Login[]): boolean {
  const own = stored.find((login) => login === actor.holder);
  if (own !== undefined) return next.includes(own);

  return next.some((login) => stored.includes(login));
}

/**
 * Replace the stored logins with one, while nobody has ever logged in.
 *
 * The caller has no login and no token of the install: it must have proven, by other means, that it may change what stands in front of the install.
 *
 * @returns every setting after the change, `not_set_up` before setup stored any, or `no_working_login` about `logins` once anybody has logged in, which changes nothing
 */
export async function storeFirstLogin(install: Pick<Install, "database" | "now">, login: Login): Promise<Stored | Refused<"not_set_up" | "no_working_login">> {
  if (await install.database.hasLoggedIn()) return refuse("no_working_login", "logins");

  const changed = await install.database.changeSettings({ logins: [login] }, { by: login, at: install.now() });
  if (changed.kind === "not_set_up") return refuse("not_set_up");

  return { ok: true, values: changed.values };
}

/**
 * Store a change of the settings an action has checked.
 *
 * @param changes - the new typed values; each key given is replaced whole
 * @returns every setting after the change, `not_set_up` before setup stored any, or `no_working_login` about `logins` for new logins with no login that works among them, which changes nothing
 */
export async function storeSettings(install: Install, actor: Actor, changes: Partial<SettingValues>): Promise<Stored | Refused<"not_set_up" | "no_working_login">> {
  if (changes.logins !== undefined) {
    const stored = await install.database.readSettings();
    if (stored === undefined) return refuse("not_set_up");

    if (!keepsWorkingLogin(actor, stored.logins, changes.logins)) return refuse("no_working_login", "logins");
  }

  const changed = await install.database.changeSettings(changes, { by: actor.holder, at: install.now() });
  if (changed.kind === "not_set_up") return refuse("not_set_up");

  return { ok: true, values: changed.values };
}
