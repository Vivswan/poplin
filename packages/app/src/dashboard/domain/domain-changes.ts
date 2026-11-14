// The change the Domain tab's settings form asks for. It answers the page to show next, with the result in its address.

import type { Change } from "../records";
import { DOMAIN_SETTINGS } from "../settings/constants";
import { saveSettings } from "../settings/save-settings";

/** Every change of the Domain tab that needs no token, by the last part of the address its form posts to. It stores the settings alone: a repair carries them to the provider. */
export const DOMAIN_CHANGES: Readonly<Record<string, Change>> = {
  save: (visit, form) => saveSettings(visit, form, { path: "/domain", holds: (key) => DOMAIN_SETTINGS.includes(key) }),
};
