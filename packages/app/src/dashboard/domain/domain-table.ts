// What the Domain tab and the setup page both show: the result of the last run as a table, then the form that asks for the next one.
//
//   3 to repair
//   Object        State     Detail
//   DNS record    missing   poplin.example.com
//   Route         present   poplin.example.com/*
//
// Every field of the form is always sent empty: a page never holds what was typed into it.

import { html } from "hono/html";

import { csrfField } from "../page/frame";
import type { Html } from "../records";
import type { DomainPlug, DomainReading, DomainRow, DomainState, DomainStep } from "./records";
import type { DomainRun } from "./domain-run";

/** The label of each state and the colour it is read in: `good` stands, `bad` needs work, `idle` was not touched. */
const STATES: Readonly<Record<DomainState, { readonly label: string; readonly tone: "good" | "bad" | "idle" }>> = {
  present: { label: "present", tone: "good" },
  missing: { label: "missing", tone: "bad" },
  differs: { label: "differs", tone: "bad" },
  "left-out": { label: "left out", tone: "idle" },
  optional: { label: "not set up: optional", tone: "idle" },
  created: { label: "created", tone: "good" },
  changed: { label: "changed", tone: "good" },
  removed: { label: "removed", tone: "good" },
  failed: { label: "failed", tone: "bad" },
  "not-run": { label: "not run", tone: "idle" },
};

/** The states a repair would change. */
const TO_REPAIR: readonly DomainState[] = ["missing", "differs"];

/** The states of a row that a run with a failure in it left as it was found. */
const UNDONE: readonly DomainState[] = [...TO_REPAIR, "not-run"];

/** The states a repair leaves on what it changed. */
const REPAIRED: readonly DomainState[] = ["created", "changed", "removed"];

/** What a reading that is no table says. */
const REFUSALS = {
  token: "Token refused.",
  unreachable: "No answer from the provider. Try again.",
  no_domain: "The token shows no domain of that name.",
  bad_domain: "The domain is no domain. Type it alone, such as example.com.",
  bad_login: "The email is no email address.",
  allowance_spent: "The database takes no more today: its free allowance for the day is used up. Try again after midnight UTC.",
} as const;

/** What the two pages show. */
interface Shown {
  /** The token every form of the answer carries back. */
  readonly csrf: string;

  /** What the token field is called. */
  readonly tokenLabel: string;

  /** The rights the token needs, in the provider's own names. */
  readonly tokenRights: readonly string[];

  /** The address of the provider's form for a new token, with those rights already chosen. */
  readonly tokenLink: string;

  /** The rights an install works without, and what each adds. */
  readonly tokenOptional: DomainPlug["tokenOptional"];

  /** What else the provider's form asks of the person. */
  readonly tokenNote: string;

  /** What the form asks for beside the token: `first` the domain and the first login of an install with nothing set, `login` an email that corrects the first login. Left out, the token alone. */
  readonly boxes?: "first" | "login";

  /** The logins the install is set to expect, said under the result of a run. Given only for a run whose token was proven. */
  readonly expects?: string;

  /** The path the forms post under: the run's name is added to it. */
  readonly path: "/domain" | "/setup";

  /** The run that led here and what it read, when a form was just answered. */
  readonly ran?: { readonly run: DomainRun; readonly reading: DomainReading };
}

function count(rows: readonly DomainRow[], states: readonly DomainState[]): number {
  return rows.filter((row) => states.includes(row.state)).length;
}

// A run goes on past a row that failed for a permission and stops at any other failure, and the rows alone do not say which: the notice counts what is left and claims neither.
function summary(run: DomainRun, rows: readonly DomainRow[]): Html {
  const failed = count(rows, ["failed"]);
  if (failed > 0) return html`<p class="notice refused" role="status">${failed + count(rows, UNDONE)} not done. Each failed row says why, or what to add.</p>`;

  const waiting = count(rows, TO_REPAIR);
  if (waiting > 0) return html`<p class="notice refused" role="status">${waiting} to repair</p>`;

  const repaired = count(rows, REPAIRED);
  if (run === "repair" && repaired > 0) return html`<p class="notice done" role="status">${repaired} repaired</p>`;

  return html`<p class="notice done" role="status">Nothing to repair.</p>`;
}

// A row that is optional is no work left over: it is said apart from the count.
function optionalNote(rows: readonly DomainRow[]): Html {
  const optional = count(rows, ["optional"]);
  if (optional === 0) return html``;

  return html`<p class="hint">${optional} optional, not set up. The install works without them. Each such row names the right that switches it on.</p>`;
}

function stepList(steps: readonly DomainStep[]): Html {
  if (steps.length === 0) return html``;

  return html`<ol>${steps.map((step) => html`<li>${step.text} <a href="${step.address}" rel="noreferrer">${step.address}</a></li>`)}</ol>`;
}

function tableRow(row: DomainRow): Html {
  const state = STATES[row.state];

  return html`<tr><td>${row.object}</td><td><strong class="state ${state.tone}">${state.label}</strong></td><td class="wrap">${row.detail}</td></tr>`;
}

function result(ran: Shown["ran"], expects: Shown["expects"]): Html {
  if (ran === undefined) return html``;

  if (!ran.reading.ok) return html`<p class="notice refused" role="status">${REFUSALS[ran.reading.refusal]}</p>`;

  return html`${summary(ran.run, ran.reading.rows)}
${optionalNote(ran.reading.rows)}
${expects === undefined ? html`` : html`<p class="hint">The login is set to expect: ${expects}</p>`}
${stepList(ran.reading.steps)}
<div class="scroll" role="region" aria-label="Domain" tabindex="0"><table>
<thead><tr><th scope="col">Object</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead>
<tbody>${ran.reading.rows.map(tableRow)}</tbody>
</table></div>`;
}

/** The boxes beside the token's. Like the token's, they are always sent empty: a page never holds what was typed into it. */
function firstFields(boxes: Shown["boxes"]): Html {
  if (boxes === undefined) return html``;

  if (boxes === "login") {
    return html`<div class="field">
<label for="login">Your email</label>
<input type="email" id="login" name="login" autocomplete="email">
<p class="hint">Leave it empty to keep the first login. If that email was wrong, type the right one: Repair sets the login to it.</p>
</div>`;
  }

  return html`<p>This install is new. Give it its domain and your email, paste a token, and press Repair.</p>
<div class="field">
<label for="domain">Domain</label>
<input type="text" id="domain" name="domain" autocomplete="off" spellcheck="false" required>
<p class="hint">The domain your sites will live under, alone: example.com</p>
</div>
<div class="field">
<label for="login">Your email</label>
<input type="email" id="login" name="login" autocomplete="email" required>
<p class="hint">The first login. The code you log in with is sent to it.</p>
</div>`;
}

function optionalRights(rights: Shown["tokenOptional"]): Html {
  if (rights.length === 0) return html``;

  return html`<p class="hint">Optional: block junk traffic and crawlers. Add any of these to the token on the form, then press Repair:</p>
<ul class="hint">${rights.map((entry) => html`<li>${entry.right}. ${entry.adds}</li>`)}</ul>`;
}

/**
 * Build the result of the last run and the form for the next one.
 *
 * @returns the summary, the steps only a person can do, and the table, when a run was just answered; then one form:
 * an empty token field, the two boxes of an install with nothing set, the way to a token with its rights, the optional rights, and the two buttons
 */
export function domainBody(shown: Shown): Html {
  return html`${result(shown.ran, shown.expects)}
<form method="post" action="${shown.path}/check">
${csrfField(shown)}
${firstFields(shown.boxes)}
<div class="field">
<label for="token">${shown.tokenLabel}</label>
<input type="password" id="token" name="token" autocomplete="off" required>
<p class="hint">Used for this one request. Never kept.</p>
<p class="hint"><a href="${shown.tokenLink}" rel="noreferrer">Make the token: the form opens with every right it needs chosen.</a></p>
<p class="hint">${shown.tokenNote}</p>
<p class="hint">If the form opens empty, add every one of these rights:</p>
<ul class="hint">${shown.tokenRights.map((right) => html`<li>${right}</li>`)}</ul>
${optionalRights(shown.tokenOptional)}
</div>
<button type="submit">${shown.ran === undefined ? "Check" : "Check again"}</button>
<button type="submit" formaction="${shown.path}/repair">Repair</button>
</form>`;
}
