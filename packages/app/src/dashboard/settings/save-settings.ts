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
 * @returns the form's own path with the result in it: saved, or the refusal with the setting it is about. A form with one of its settings left out changes nothing
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

  const changes = Object.fromEntries(held.map((key) => [key, read.values[key]]));
  const changed = await changeConfig(visit.install, visit.actor, changes);
  if (!changed.ok) return withNotice(part.path, { refused: changed.code, about: changed.about });

  return withNotice(part.path, { done: "saved" });
}
