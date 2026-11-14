// The one way an action changes the stored settings: a change of the logins is stored only while it leaves somebody able to log in.
//
// The login page in front of an install keeps a list of its own, which follows the stored logins only when an admin repairs it from the dashboard.
// So an email that was just stored gets nobody in yet, and a list made of such emails alone shuts the dashboard on everyone, the way back included.

import type { Login } from "../auth/logins";
import type { Actor } from "../auth/scopes";
import type { SettingValues } from "../records/settings";
import { type Install, type Refused, refuse } from "./records";

/** The settings as they are after a change. */
interface Stored {
  readonly ok: true;
  readonly values: SettingValues;
}

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
