// The changes the forms of the Settings tab ask for. Each answers the page to show next, with the result in its address.

import { changeConfig, readConfig } from "@poplin/core/src/actions/config";
import { signEveryoneOut } from "@poplin/core/src/actions/sign-out";
import { type SettingValues, settingsFromText, settingsToText } from "@poplin/core/src/records/settings";

import { withNotice } from "../page/notices";
import type { Change, Form, Visit } from "../records";
import { requireFields } from "../security/form";
import { ZONE_SETTINGS } from "./constants";

/** The path of the Settings tab. */
const SETTINGS_PATH = "/settings";

/** What the sign-out form's box sends when it is ticked. */
const CONFIRMED = "yes";

async function saveSettings(visit: Visit, form: Form): Promise<string> {
  const config = await readConfig(visit.install, visit.actor);
  if (!config.ok) return withNotice(SETTINGS_PATH, { refused: config.code });

  const current = settingsToText(config.values);
  const ordinary = (Object.keys(current) as (keyof SettingValues)[]).filter((key) => !ZONE_SETTINGS.includes(key));
  const typed = requireFields(form, ordinary);
  if (typed === undefined) return withNotice(SETTINGS_PATH, { refused: "missing_field" });

  // A setting is read from its text beside every other one, so the Zone tab's settings go along as they are stored and are not sent on.
  const read = settingsFromText({ ...current, ...typed });
  if (!read.ok) return withNotice(SETTINGS_PATH, { refused: "bad_argument", about: read.key });

  const changes = Object.fromEntries(ordinary.map((key) => [key, read.values[key]]));
  const changed = await changeConfig(visit.install, visit.actor, changes);
  if (!changed.ok) return withNotice(SETTINGS_PATH, { refused: changed.code, about: changed.about });

  return withNotice(SETTINGS_PATH, { done: "saved" });
}

async function signOut(visit: Visit, form: Form): Promise<string> {
  if (form.get("confirm") !== CONFIRMED) return withNotice(SETTINGS_PATH, { refused: "not_confirmed" });

  const signedOut = await signEveryoneOut(visit.install, visit.actor);
  if (!signedOut.ok) return withNotice(SETTINGS_PATH, { refused: signedOut.code });

  return visit.login;
}

/** Every change of the settings, by the last part of the address its form posts to. */
export const SETTINGS_CHANGES: Readonly<Record<string, Change>> = {
  save: saveSettings,
  "sign-everyone-out": signOut,
};
