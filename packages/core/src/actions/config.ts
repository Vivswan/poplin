// The install's settings, read and changed by an admin.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { SETTING_CHANGES, type SettingValues } from "../records/settings";
import { type Install, type Refused, refuse } from "./records";
import { storeSettings } from "./store-settings";

/** The settings as they are after the action. */
interface Configured {
  readonly ok: true;
  readonly values: SettingValues;
}

/**
 * Read every setting.
 *
 * @returns the values, `not_allowed` for anyone but an admin, or `not_set_up` before setup stored them
 */
export async function readConfig(install: Install, actor: Actor): Promise<Configured | Refused<"not_allowed" | "not_set_up">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const values = await install.database.readSettings();
  if (values === undefined) return refuse("not_set_up");

  return { ok: true, values };
}

/**
 * Change some settings. Each key given is replaced whole; every other key stays as it is.
 *
 * @param changes - the new typed values, at least one key; anything is taken and checked
 * @returns every setting after the change, `bad_argument` naming the first key that is no setting or whose value breaks its rule, with `about` as `settings` when no key is given, or `no_working_login` for new logins that would let nobody log in
 */
export async function changeConfig(install: Install, actor: Actor, changes: unknown): Promise<Configured | Refused<"not_allowed" | "not_set_up" | "bad_argument" | "no_working_login">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const checked = v.safeParse(SETTING_CHANGES, changes);
  if (!checked.success) return refuse("bad_argument", v.getDotPath(checked.issues[0])?.split(".")[0] ?? "settings");

  if (Object.keys(checked.output).length === 0) return refuse("bad_argument", "settings");

  return storeSettings(install, actor, checked.output);
}
