// Which settings the Settings screen treats apart from the rest.

import type { SettingValues } from "@poplin/core/src/records/settings";

/** The settings whose change is also a change to rules on the domain: the install obeys a new value at once, the domain's own rules after the next repair. */
export const DOMAIN_SETTINGS: readonly (keyof SettingValues)[] = ["outside_pages", "search_engines_allowed", "block_bots"];

/** The settings the Access screen changes: the Settings screen neither shows nor saves them. */
export const ACCESS_SETTINGS: readonly (keyof SettingValues)[] = ["logins"];
