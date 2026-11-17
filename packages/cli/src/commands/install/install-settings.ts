// The install settings `poplin config` takes: core's keys, each with one accepted text. A typed value is read by core's own reading of its key.

import { parseLogin } from "../../../../core/src/auth/logins";
import { defaultSettings, type SettingValues, settingsToText } from "../../../../core/src/records/settings";

/** A login in core's form, so the defaults below can be built. */
const SAMPLE_INSTALLER = parseLogin("installer@example.com");

/** One accepted text for every key, in core's order: the keys there are, and what `poplin config --help` shows of each. */
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
