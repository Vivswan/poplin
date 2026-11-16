// The Worker's `FIRST_SETTINGS` binding: the settings an install starts with, as texts. The Worker stores them on its first start, and a repair from a terminal mends to them before that start.
//
//   { logins: "you@example.com", ... }    the first logins, comma-separated, and any other setting as its text; every setting left out starts at its default

import { parseLogins } from "@poplin/core/src/auth/logins";
import { defaultSettings, type SettingValues, settingsFromText, settingsToText } from "@poplin/core/src/records/settings";
import * as v from "valibot";

/** The binding's shape: each setting by its name, as text. */
const SETTING_TEXTS = v.record(v.string(), v.string());

/** The settings a binding names, or why it names none, in the words a start that is refused is logged with. */
type FirstSettings = { readonly ok: true; readonly values: SettingValues } | { readonly ok: false; readonly refusal: string };

function refused(refusal: string): FirstSettings {
  return { ok: false, refusal };
}

/**
 * Read the settings an install starts with from its `FIRST_SETTINGS` binding.
 *
 * The binding must name the logins; every setting it leaves out starts at its default.
 *
 * @param binding - the binding as the runtime or the provider's API hands it over, of any type; `undefined` for a Worker with none
 * @returns every setting, or the refusal: `absent`, `bad-shape`, a setting that is none, or the rule a value breaks with the setting's name. No refusal repeats a value
 */
export function readFirstSettings(binding: unknown): FirstSettings {
  if (binding === undefined) return refused("absent");

  const texts = v.safeParse(SETTING_TEXTS, binding);
  if (!texts.success) return refused("bad-shape");

  const emails = (texts.output.logins ?? "").split(",").map((email) => email.trim());
  const stated = parseLogins(emails.filter((email) => email !== ""));
  const [firstLogin] = stated.ok ? stated.value : [];
  if (firstLogin === undefined) return refused(stated.ok || stated.refusal === "no-logins" ? "missing at logins" : "bad-form at logins");

  const first = settingsFromText({ ...settingsToText(defaultSettings({ installer: firstLogin })), ...texts.output });
  // A key that is no setting is text of the binding's own, so it is not repeated.
  if (!first.ok && first.refusal === "unknown-key") return refused(first.refusal);

  if (!first.ok) return refused(`${first.refusal} at ${first.key}`);

  return first.values.logins.length === 0 ? refused("missing at logins") : { ok: true, values: first.values };
}
