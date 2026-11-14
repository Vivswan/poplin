// What the Domain tab and the setup page both show: the result of the last run as a table, then the form that asks for the next one.
//
//   3 to repair
//   Object        State     Detail
//   DNS record    missing   poplin.example.com
//   Route         present   poplin.example.com/*
//
// The token field is always sent empty: a page never holds the token it was asked with.

import { html } from "hono/html";

import { csrfField } from "../page/frame";
import type { Html } from "../records";
import type { DomainReading, DomainRow, DomainState, DomainStep } from "./records";
import type { DomainRun } from "./domain-run";

/** The label of each state and the colour it is read in: `good` stands, `bad` needs work, `idle` was not touched. */
const STATES: Readonly<Record<DomainState, { readonly label: string; readonly tone: "good" | "bad" | "idle" }>> = {
  present: { label: "present", tone: "good" },
  missing: { label: "missing", tone: "bad" },
  differs: { label: "differs", tone: "bad" },
  "left-out": { label: "left out", tone: "idle" },
  created: { label: "created", tone: "good" },
  changed: { label: "changed", tone: "good" },
  removed: { label: "removed", tone: "good" },
  failed: { label: "failed", tone: "bad" },
  "not-run": { label: "not run", tone: "idle" },
};

/** The states a repair would change. */
const TO_REPAIR: readonly DomainState[] = ["missing", "differs"];

/** The states a repair leaves on what it changed. */
const REPAIRED: readonly DomainState[] = ["created", "changed", "removed"];

/** What a reading that is no table says. */
const REFUSALS = { token: "Token refused.", unreachable: "No answer from the provider. Try again.", not_set_up: "This install is not set up yet." } as const;

/** What the two pages show. */
interface Shown {
  /** The token every form of the answer carries back. */
  readonly csrf: string;

  /** What the token field is called. */
  readonly tokenLabel: string;

  /** The rights the token needs, in the provider's own names. */
  readonly tokenRights: readonly string[];

  /** The path the forms post under: the run's name is added to it. */
  readonly path: "/domain" | "/setup";

  /** The run that led here and what it read, when a form was just answered. */
  readonly ran?: { readonly run: DomainRun; readonly reading: DomainReading };
}

function count(rows: readonly DomainRow[], states: readonly DomainState[]): number {
  return rows.filter((row) => states.includes(row.state)).length;
}

function summary(run: DomainRun, rows: readonly DomainRow[]): Html {
  if (count(rows, ["failed"]) > 0) return html`<p class="notice refused" role="status">Stopped at a failure.</p>`;

  const waiting = count(rows, TO_REPAIR);
  if (waiting > 0) return html`<p class="notice refused" role="status">${waiting} to repair</p>`;

  const repaired = count(rows, REPAIRED);
  if (run === "repair" && repaired > 0) return html`<p class="notice done" role="status">${repaired} repaired</p>`;

  return html`<p class="notice done" role="status">Nothing to repair.</p>`;
}

function stepList(steps: readonly DomainStep[]): Html {
  if (steps.length === 0) return html``;

  return html`<ol>${steps.map((step) => html`<li>${step.text} <a href="${step.address}" rel="noreferrer">${step.address}</a></li>`)}</ol>`;
}

function tableRow(row: DomainRow): Html {
  const state = STATES[row.state];

  return html`<tr><td>${row.object}</td><td><strong class="state ${state.tone}">${state.label}</strong></td><td class="wrap">${row.detail}</td></tr>`;
}

function result(ran: Shown["ran"]): Html {
  if (ran === undefined) return html``;

  if (!ran.reading.ok) return html`<p class="notice refused" role="status">${REFUSALS[ran.reading.refusal]}</p>`;

  return html`${summary(ran.run, ran.reading.rows)}
${stepList(ran.reading.steps)}
<div class="scroll" role="region" aria-label="Domain" tabindex="0"><table>
<thead><tr><th scope="col">Object</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead>
<tbody>${ran.reading.rows.map(tableRow)}</tbody>
</table></div>`;
}

/**
 * Build the result of the last run and the form for the next one.
 *
 * @returns the summary, the steps only a person can do, and the table, when a run was just answered; then one form with an empty token field, the rights its token needs, and the two buttons
 */
export function domainBody(shown: Shown): Html {
  return html`${result(shown.ran)}
<form method="post" action="${shown.path}/check">
${csrfField(shown)}
<div class="field">
<label for="token">${shown.tokenLabel}</label>
<input type="password" id="token" name="token" autocomplete="off" required>
<p class="hint">Used for this one request. Never kept.</p>
<p class="hint">Create a token with these rights:</p>
<ul class="hint">${shown.tokenRights.map((right) => html`<li>${right}</li>`)}</ul>
</div>
<button type="submit">${shown.ran === undefined ? "Check" : "Check again"}</button>
<button type="submit" formaction="${shown.path}/repair">Repair</button>
</form>`;
}
