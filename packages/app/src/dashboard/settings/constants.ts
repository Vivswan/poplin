// Which settings the Settings tab shows and never changes.

import type { SettingValues } from "@poplin/core/src/records/settings";

/** The settings whose change is also a change to rules on the domain: they are changed on the Domain tab. */
export const DOMAIN_SETTINGS: readonly (keyof SettingValues)[] = ["outside_pages", "search_engines_allowed", "block_bots"];
