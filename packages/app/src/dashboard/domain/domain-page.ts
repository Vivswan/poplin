// The Domain tab: the install's objects at the provider, checked and repaired with a token pasted for the one request, and the three settings a repair carries there.

import { readConfig } from "@poplin/core/src/actions/config";
import { type SettingValues, settingsToText } from "@poplin/core/src/records/settings";
import { html } from "hono/html";

import { csrfField, refusedPage } from "../page/frame";
import type { Form, Html, Page, Visit } from "../records";
import { type DomainRun, REFUSAL_STATUS, runDomain } from "./domain-run";
import type { DomainPlug, GuardKey } from "./records";
import { domainBody } from "./domain-table";

/** The values each of the three settings takes. A key missing here does not compile. */
const OPTIONS: Readonly<Record<GuardKey, readonly string[]>> = {
  outside_pages: ["blocked", "allowed"],
  search_engines_allowed: ["off", "on"],
  block_bots: ["auto", "on", "off"],
};

/** A form that asks for a run. */
interface Asked {
  readonly run: DomainRun;
  readonly form: Form;
}

function guardRow(key: GuardKey, stored: string, note: string): Html {
  const options = OPTIONS[key].map((option) => (option === stored ? html`<option selected>${option}</option>` : html`<option>${option}</option>`));

  return html`<div class="setting">
<div>
<label for="${key}"><code>${key}</code></label>
<p class="hint">${note}</p>
</div>
<div><select id="${key}" name="${key}">${options}</select></div>
</div>`;
}

function guardsForm(visit: Visit, values: SettingValues, notes: DomainPlug["guardNotes"]): Html {
  const texts = settingsToText(values);
  const keys = Object.keys(OPTIONS) as GuardKey[];

  return html`<h2>Guards</h2>
<form method="post" action="/domain/save">
${csrfField(visit)}
${keys.map((key) => guardRow(key, texts[key], notes[key]))}
<button type="submit">Save</button>
<p class="hint">Repair applies them.</p>
</form>`;
}

/**
 * Show the Domain tab, after the run a form asked for when there is one.
 *
 * @param plug - the provider's side, which names the token field, says what each setting does there, and answers a run
 * @param asked - the posted form; left out for a page that was only opened
 * @returns the table of the run, the token form, and the three settings; a token the provider refuses is a 403 with no table, a provider that did not answer a 502
 * @throws {Error} the plug or the database failed
 */
export async function showDomain(visit: Visit, plug: DomainPlug, asked?: Asked): Promise<Page> {
  const { tokenLabel, tokenRights, tokenLink, tokenByHand, tokenNote } = plug;
  const asks = { csrf: visit.csrf, tokenLabel, tokenRights, tokenLink, tokenByHand, tokenNote, path: "/domain" } as const;
  const place = { tab: "domain", heading: "Domain" } as const;
  const config = await readConfig(visit.install, visit.actor);
  if (!config.ok) return refusedPage(place, config);

  if (asked === undefined)
    return { ...place, body: html`${domainBody(asks)}${guardsForm(visit, config.values, plug.guardNotes)}` };

  const token = asked.form.get("token") ?? "";
  const reading = await runDomain(plug, visit.install, {
    run: asked.run,
    token,
    settings: async () => config.values,
    by: visit.actor.holder,
    from: "dashboard",
  });
  const body = html`${domainBody({ ...asks, ran: { run: asked.run, reading } })}${guardsForm(visit, config.values, plug.guardNotes)}`;
  if (reading.ok) return { ...place, body };

  return { ...place, body, status: REFUSAL_STATUS[reading.refusal] };
}
