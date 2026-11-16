// Which settings the Settings screen treats apart from the rest.

import type { SettingValues } from "@poplin/core/src/records/settings";

/** The settings the Access screen changes: the Settings screen neither shows nor saves them. */
export const ACCESS_SETTINGS: readonly (keyof SettingValues)[] = ["logins"];
