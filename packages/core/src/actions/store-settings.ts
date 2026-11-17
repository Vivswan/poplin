// The one way an action changes the stored settings: a change of the logins is stored only while it leaves somebody able to log in, and `auto_update` is stored on only beside `update_check`.
//
// The login page in front of an install keeps a list of its own, which follows the stored logins when the install carries them there or an admin repairs it from the dashboard.
// So an email that was just stored may get nobody in yet, and a list made of such emails alone shuts the dashboard on everyone, the way back included.

import * as v from "valibot";

import type { Login } from "../auth/logins";
import type { Actor } from "../auth/scopes";
import { SETTING_VALUES, type SettingValues } from "../records/settings";
import { signedBy } from "./reach";
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
 * Store a change of the settings an action has checked.
 *
 * @param changes - the new typed values; each key given is replaced whole
 * @returns every setting after the change, `not_set_up` before setup stored any, or `no_working_login` about `logins` for new logins with no login that works among them.
 *   `needs_update_check` about `auto_update` for a change that would leave it on with `update_check` off, whichever of the two the change names.
 *   `not_allowed` for a token whose user was removed while it asked, and for a person removed while they asked. A refusal changes nothing
 */
export async function storeSettings(install: Install, actor: Actor, changes: Partial<SettingValues>): Promise<Stored | Refused<"not_set_up" | "no_working_login" | "needs_update_check" | "not_allowed">> {
  if (changes.logins !== undefined) {
    const stored = await install.database.readSettings();
    if (stored === undefined) return refuse("not_set_up");

    if (!keepsWorkingLogin(actor, stored.logins, changes.logins)) return refuse("no_working_login", "logins");
  }

  const changed = await install.database.changeSettings(changes, signedBy(actor, install.now()));
  if (changed.kind === "done" || changed.kind === "unchanged") return { ok: true, values: changed.values };

  if (changed.kind === "needs_update_check") return refuse("needs_update_check", "auto_update");

  return refuse(changed.kind === "signer_gone" ? "not_allowed" : "not_set_up");
}
