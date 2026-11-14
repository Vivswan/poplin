// The Settings tab: every setting of the install with its value, an input, and its default.

import { readConfig } from "@poplin/core/src/actions/config";
import { defaultSettings, type SettingValues, settingsToText } from "@poplin/core/src/records/settings";
import { html } from "hono/html";

import { csrfField, refusedPage } from "../page/frame";
import type { Html, Page, Visit } from "../records";
import { DOMAIN_SETTINGS } from "./constants";
import { freeLimitWarnings } from "./free-limits";

/** What each setting means, in a line. A key missing here does not compile. */
const MEANINGS: { readonly [Key in keyof SettingValues]: string } = {
  default_expires: "The expiry a new site gets: never, or a span such as 30d.",
  default_search_engines: "Whether search engines may list a new site: on or off.",
  versions_kept: "How many versions each site keeps, the live one included.",
  trash_days: "How many days a deleted site waits in the trash.",
  logins: "The emails that may log in, with commas between them. A new email gets in after a Repair on the Domain tab.",
  dashboard_title: "The title of this dashboard.",
  outside_pages: "Whether pages outside the install may frame a site or load its files.",
  search_engines_allowed: "Whether search engines are let through to public sites.",
  block_bots: "The zone's bot switches.",
  max_total_size: "The most all sites hold together, such as 9GB.",
  max_site_size: "The most one site holds, such as 200MB.",
  max_sites: "The most sites, or none for no limit.",
  requests_per_day: "The day's requests, all sites together.",
  site_share_of_day: "The share of the day's requests one site may take, such as 25%.",
  site_requests_per_minute: "The requests one site answers in a minute.",
  visitor_requests_per_minute: "The requests one visitor is answered in a minute.",
};

/** The default of the one setting whose default this page cannot know. */
const DEFAULT_LOGINS = "the email of whoever set the install up";

/** A setting's key. */
type Key = keyof SettingValues;

/** What a row is built from. */
interface Row {
  readonly key: Key;
  readonly text: string;
  readonly fallback: string;
  readonly warning?: string;
}

function defaultTexts(values: SettingValues, hostname: string): Readonly<Record<Key, string>> {
  const [installer] = values.logins;
  if (installer === undefined) return settingsToText(values);

  return { ...settingsToText(defaultSettings({ installer, hostname })), logins: DEFAULT_LOGINS };
}

function warningLine(row: Row): Html {
  if (row.warning === undefined) return html``;

  return html`<p class="warning" id="${row.key}-warning"><strong>Warning:</strong> ${row.warning}</p>`;
}

function settingRow(row: Row): Html {
  return html`<div class="setting">
<div>
<label for="${row.key}"><code>${row.key}</code></label>
<p class="hint">${MEANINGS[row.key]}</p>
</div>
<div>
<input type="text" id="${row.key}" name="${row.key}" value="${row.text}" autocomplete="off">
<p class="hint">Default: ${row.fallback}</p>
${warningLine(row)}
</div>
</div>`;
}

function zoneRow(row: Row): Html {
  return html`<dt><code>${row.key}</code></dt><dd>${row.text}</dd>`;
}

function signOutForm(visit: Visit): Html {
  return html`<h2>Sign everyone out</h2>
<form method="post" action="/settings/sign-everyone-out">
${csrfField(visit)}
<p>Every browser logged in to this dashboard, this one included, has to log in again. Private sites keep their own login, and agent tokens and site addresses stay as they are.</p>
<div class="field">
<label class="choice"><input type="checkbox" name="confirm" value="yes"> Yes, sign everyone out</label>
</div>
<button type="submit" class="danger">Sign everyone out</button>
</form>`;
}

/**
 * Show the settings.
 *
 * @returns one input per ordinary setting in one form, the Domain tab's settings as text, a warning beside each stored value that is above a free limit of Cloudflare, and the sign-out form
 */
export async function showSettings(visit: Visit): Promise<Page> {
  const place = { tab: "settings", heading: "Settings" } as const;
  const config = await readConfig(visit.install, visit.actor);
  if (!config.ok) return refusedPage(place, config);

  const texts = settingsToText(config.values);
  const defaults = defaultTexts(config.values, visit.url.hostname);
  const warnings = freeLimitWarnings(config.values);
  const rows = (Object.keys(texts) as Key[]).map((key): Row => ({ key, text: texts[key], fallback: defaults[key], warning: warnings.get(key) }));
  const ordinary = rows.filter((row) => !DOMAIN_SETTINGS.includes(row.key));
  const zone = rows.filter((row) => DOMAIN_SETTINGS.includes(row.key));

  const body = html`<form method="post" action="/settings/save">
${csrfField(visit)}
${ordinary.map(settingRow)}
<button type="submit">Save settings</button>
</form>
<h2>Changed on the Domain tab</h2>
<p>These settings also change rules on your domain, so they are changed on the Domain tab.</p>
<dl>${zone.map(zoneRow)}</dl>
${signOutForm(visit)}`;

  return { ...place, body };
}
