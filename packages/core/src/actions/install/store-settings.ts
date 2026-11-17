// The one way an action changes the stored settings: a change of the logins is stored only while it leaves somebody able to log in, and `auto_update` is stored on only beside `update_check`.
//
// The login page in front of an install keeps a list of its own, which follows the stored logins when the install carries them there or an admin repairs it from the dashboard.
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
 * Decide whether new logins keep one that works.
 *
 * A login works when the login page is known to let it in: the email of an admin who came through that page to make this change, or, for a change made with a token, any email that was a login before it.
 */
function keepsWorkingLogin(actor: Actor, stored: readonly Login[], next: readonly Login[]): boolean {
  const own = stored.find((login) => login === actor.holder);
  if (own !== undefined) return next.includes(own);

  return next.some((login) => stored.includes(login));
}

/** The settings a change would leave, each key it names replaced whole, with nothing stored; or the refusal of a pair of update settings the store does not take. */
function rehearsed(stored: SettingValues, changes: Partial<SettingValues>): Stored | Refused<"needs_update_check"> {
  // A key given with no value names no change, as the store reads it.
  const values = { ...stored, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };

  return values.auto_update && !values.update_check ? refuse("needs_update_check", "auto_update") : { ok: true, values };
}

/**
 * Store a change of the settings an action has checked.
 *
 * @param changes - the new typed values; each key given is replaced whole
 * @param how - with `dry_run` nothing is stored: the answer is every setting as the change would leave it, judged against the settings as they are read
 * @returns every setting after the change, `not_set_up` before setup stored any, or `no_working_login` about `logins` for new logins with no login that works among them.
 *   `needs_update_check` about `auto_update` for a change that would leave it on with `update_check` off, whichever of the two the change names.
 *   `not_allowed` for a token whose user was removed while it asked, and for a person removed while they asked. A refusal changes nothing
 */
export async function storeSettings(install: Install, actor: Actor, changes: Partial<SettingValues>, how: Rehearsal = {}): Promise<Stored | Refused<"not_set_up" | "no_working_login" | "needs_update_check" | "not_allowed">> {
  const rehearsing = how.dry_run === true;
  if (changes.logins !== undefined || rehearsing) {
    const stored = await install.database.readSettings();
    if (stored === undefined) return refuse("not_set_up");

    if (changes.logins !== undefined && !keepsWorkingLogin(actor, stored.logins, changes.logins)) return refuse("no_working_login", "logins");

    if (rehearsing) return rehearsed(stored, changes);
  }

  const changed = await install.database.changeSettings(changes, signedBy(actor, install.now()));
  if (changed.kind === "done" || changed.kind === "unchanged") return { ok: true, values: changed.values };

  if (changed.kind === "needs_update_check") return refuse("needs_update_check", "auto_update");

  return refuse(changed.kind === "signer_gone" ? "not_allowed" : "not_set_up");
}
