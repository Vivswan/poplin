// Import the settings of a backup, when an admin asks for it by name. A site's import never touches them.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { POSITIVE } from "../records/fields";
import { type SettingValues, settingsFromText } from "../records/settings";
import { BACKUP_FORMAT } from "./export";
import { type Install, type Refused, refuse } from "./records";
import { storeSettings } from "./store-settings";

/** What an import of settings sends: the backup's format number, every setting in its text form, and whether the backup's logins replace this install's. */
export const SETTINGS_IMPORT = v.strictObject({
  format: POSITIVE,
  settings: v.record(v.string(), v.string()),
  logins: v.optional(v.boolean(), false),
});

/**
 * Replace this install's settings with a backup's. The logins stay as they are unless `logins` asks for the backup's: another install's logins could shut every admin of this one out.
 *
 * @param request - what `exportSettings` answered, as `format` and `settings`; anything is taken and checked
 * @returns every setting after the change. `backup_too_new` for a format above the one this code reads, `bad_argument` naming the first key that is no setting, is missing, or whose text is refused, `no_working_login` for logins that let nobody in
 */
export async function importSettings(
  install: Install,
  actor: Actor,
  request: v.InferInput<typeof SETTINGS_IMPORT>,
): Promise<{ readonly ok: true; readonly values: SettingValues } | Refused<"not_allowed" | "not_set_up" | "bad_argument" | "backup_too_new" | "no_working_login">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(SETTINGS_IMPORT, request);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "request");

  if (asked.output.format > BACKUP_FORMAT) return refuse("backup_too_new", "format");

  const read = settingsFromText(asked.output.settings);
  if (!read.ok) return refuse("bad_argument", read.key);

  const { logins, ...rest } = read.values;
  const changes = asked.output.logins ? read.values : rest;

  return storeSettings(install, actor, changes);
}
