// Which settings the Settings tab shows and never changes.

import type { SettingValues } from "@poplin/core/src/records/settings";

/** The settings whose change is also a change at Cloudflare: they are changed on the Zone tab. */
export const ZONE_SETTINGS: readonly (keyof SettingValues)[] = ["outside_pages", "search_engines_allowed", "zone_bots"];
