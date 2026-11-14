// The changes the forms of the Settings tab ask for. Each answers the page to show next, with the result in its address.

import { signEveryoneOut } from "@poplin/core/src/actions/sign-out";

import { withNotice } from "../page/notices";
import type { Change, Form, Visit } from "../records";
import { DOMAIN_SETTINGS } from "./constants";
import { saveSettings } from "./save-settings";

/** The path of the Settings tab. */
const SETTINGS_PATH = "/settings";

/** What the sign-out form's box sends when it is ticked. */
const CONFIRMED = "yes";

async function signOut(visit: Visit, form: Form): Promise<string> {
  if (form.get("confirm") !== CONFIRMED) return withNotice(SETTINGS_PATH, { refused: "not_confirmed" });

  const signedOut = await signEveryoneOut(visit.install, visit.actor);
  if (!signedOut.ok) return withNotice(SETTINGS_PATH, { refused: signedOut.code });

  return visit.login;
}

/** Every change of the settings, by the last part of the address its form posts to. */
export const SETTINGS_CHANGES: Readonly<Record<string, Change>> = {
  save: (visit, form) => saveSettings(visit, form, { path: SETTINGS_PATH, holds: (key) => !DOMAIN_SETTINGS.includes(key) }),
  "sign-everyone-out": signOut,
};
