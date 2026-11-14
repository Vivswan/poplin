// One form's settings, saved: the Settings tab's form and the Domain tab's each hold a part of the settings and save it the same way.

import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { type SettingValues, settingsFromText, settingsToText } from "@poplin/core/src/records/settings";

import { withNotice } from "../page/notices";
import type { Form, Visit } from "../records";
import { requireFields } from "../security/form";

/** A form's part of the settings. */
interface Part {
  /** The tab the form is on, where the browser goes next. */
  readonly path: string;

  /** Whether the form holds a setting. */
  readonly holds: (key: keyof SettingValues) => boolean;
}

/**
 * Save the settings one form holds.
 *
 * @returns the form's own path with the result in it: saved, saved with the one more step a change of the logins needs, or the refusal with the setting it is about. A form with one of its settings left out changes nothing
 */
export async function saveSettings(visit: Visit, form: Form, part: Part): Promise<string> {
  const config = await readConfig(visit.install, visit.actor);
  if (!config.ok) return withNotice(part.path, { refused: config.code });

  const current = settingsToText(config.values);
  const held = (Object.keys(current) as (keyof SettingValues)[]).filter(part.holds);
  const typed = requireFields(form, held);
  if (typed === undefined) return withNotice(part.path, { refused: "missing_field" });

  // A setting is read from its text beside every other one, so the settings of the other form go along as they are stored and are not sent on.
  const read = settingsFromText({ ...current, ...typed });
  if (!read.ok) return withNotice(part.path, { refused: "bad_argument", about: read.key });

  // A session is checked against the stored logins on every request, and the login page lets a new email in only after a repair: an admin who took their own email out would shut the dashboard on everyone.
  if (held.includes("logins") && !read.values.logins.includes(visit.actor.holder as SettingValues["logins"][number])) return withNotice(part.path, { refused: "own_login" });

  const changes = Object.fromEntries(held.map((key) => [key, read.values[key]]));
  const changed = await changeConfig(visit.install, visit.actor, changes);
  if (!changed.ok) return withNotice(part.path, { refused: changed.code, about: changed.about });

  // The login in front of the dashboard keeps a list of its own, which only a repair on the Domain tab brings up to the stored one.
  const loginsChanged = held.includes("logins") && read.values.logins.join() !== config.values.logins.join();

  return withNotice(part.path, { done: loginsChanged ? "saved_logins" : "saved" });
}
