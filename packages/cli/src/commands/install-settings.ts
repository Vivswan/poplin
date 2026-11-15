// The install settings `poplin config` takes: core's keys, and core's text form of each value.

import { parseLogin } from "../../../core/src/auth/logins";
import { defaultSettings, type SettingValues, settingsFromText, settingsToText } from "../../../core/src/records/settings";

/** A login in core's form, so the defaults below can be built. */
const SAMPLE_INSTALLER = parseLogin("installer@example.com");

/** One accepted text for every key, in core's order. Core reads all the settings at once, so one typed value is read among these. */
export const SETTING_SAMPLES: Readonly<Record<string, string>> = SAMPLE_INSTALLER.ok
  ? settingsToText(defaultSettings({ installer: SAMPLE_INSTALLER.value }))
  : {};

/** The key of one install setting. */
export type SettingKey = keyof SettingValues;

/**
 * Decide whether a word is the key of an install setting.
 */
export function isSettingKey(word: string): word is SettingKey {
  return Object.hasOwn(SETTING_SAMPLES, word);
}

/**
 * Read the text typed as one setting's value, with core's own reading of that key.
 *
 * @returns the typed value, or nothing when core refuses the text for that key
 */
export function readSetting<Key extends SettingKey>(key: Key, text: string): SettingValues[Key] | undefined {
  const checked = settingsFromText({ ...SETTING_SAMPLES, [key]: text });
  if (!checked.ok) return undefined;

  return checked.values[key];
}
