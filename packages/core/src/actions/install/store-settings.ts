// The one way an action changes the stored settings: a change of the users is stored only while it leaves somebody able to log in, `auto_update` is stored on only beside `update_check`, and `alert_users` only while each is a user.
//
// The login page in front of an install keeps a list of its own, which follows the stored users when the install carries them there or an admin repairs it from the dashboard.
// So an email that was just stored may get nobody in yet, and a list made of such emails alone shuts the dashboard on everyone, the way back included.

import * as v from "valibot";

import type { Login } from "../../auth/logins";
import type { Actor } from "../../auth/scopes";
import { SETTING_VALUES, type SettingValues } from "../../records/settings";
import { signedBy } from "../access/reach";
import { type Install, type Refused, type Rehearsal, refuse } from "../records";

/** What reading or changing the settings answers: every setting. */
export const SETTINGS_ANSWER = v.object({ values: SETTING_VALUES });

/** The settings as they are, read or after a change. */
export type Stored = { readonly ok: true } & Readonly<v.InferOutput<typeof SETTINGS_ANSWER>>;

/**
 * Decide whether new users keep one that works.
 *
 * A login works when the login page is known to let it in: the email of an admin who came through that page to make this change, or, for a change made with a token, any email that was a login before it.
 */
function keepsWorkingLogin(actor: Actor, stored: readonly Login[], next: readonly Login[]): boolean {
  const own = stored.find((login) => login === actor.holder);
  if (own !== undefined) return next.includes(own);

  return next.some((login) => stored.includes(login));
}

/** The settings a change would leave, each key it names replaced whole, with nothing stored; or the refusal of a pair of settings the store does not take. */
function rehearsed(stored: SettingValues, changes: Partial<SettingValues>): Stored | Refused<"needs_update_check" | "not_a_user"> {
  // A key given with no value names no change, as the store reads it.
  const merged = { ...stored, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
  // New users given without the users the alerts go to take whoever they drop out of that list, as the store does.
  const values = changes.alert_users === undefined ? { ...merged, alert_users: merged.alert_users.filter((login) => merged.users.includes(login)) } : merged;
  if (values.auto_update && !values.update_check) return refuse("needs_update_check", "auto_update");

  return values.alert_users.every((login) => values.users.includes(login)) ? { ok: true, values } : refuse("not_a_user", "alert_users");
}

/**
 * Store a change of the settings an action has checked.
 *
 * @param changes - the new typed values; each key given is replaced whole
 * @param how - with `dry_run` nothing is stored: the answer is every setting as the change would leave it, judged against the settings as they are read
 * @returns every setting after the change, `not_set_up` before setup stored any, or `no_working_user` about `users` for new users with no login that works among them.
 *   `needs_update_check` about `auto_update` for a change that would leave it on with `update_check` off, whichever of the two the change names.
 *   `not_a_user` about `alert_users` for a change that names them and would leave an email there that is none of the users.
 *   `not_allowed` for a token whose user was removed while it asked, and for a person removed while they asked. A refusal changes nothing
 */
export async function storeSettings(install: Install, actor: Actor, changes: Partial<SettingValues>, how: Rehearsal = {}): Promise<Stored | Refused<"not_set_up" | "no_working_user" | "needs_update_check" | "not_a_user" | "not_allowed">> {
  const rehearsing = how.dry_run === true;
  if (changes.users !== undefined || rehearsing) {
    const stored = await install.database.readSettings();
    if (stored === undefined) return refuse("not_set_up");

    if (changes.users !== undefined && !keepsWorkingLogin(actor, stored.users, changes.users)) return refuse("no_working_user", "users");

    if (rehearsing) return rehearsed(stored, changes);
  }

  const changed = await install.database.changeSettings(changes, signedBy(actor, install.now()));
  if (changed.kind === "done" || changed.kind === "unchanged") return { ok: true, values: changed.values };

  if (changed.kind === "needs_update_check") return refuse("needs_update_check", "auto_update");

  if (changed.kind === "not_a_user") return refuse("not_a_user", "alert_users");

  return refuse(changed.kind === "signer_gone" ? "not_allowed" : "not_set_up");
}
