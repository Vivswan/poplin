// The page where an admin allows or denies a computer's login: the code, large, to hold against the one on the computer, then what the login asks for.

import { showLogin } from "@poplin/core/src/actions/computer-logins";
import { CODE_KEY } from "@poplin/core/src/api/routes";
import { html } from "hono/html";

import { showMoment } from "../page/amounts";
import { csrfField } from "../page/frame";
import { refusalSentence } from "../page/notices";
import type { Html, Page, Visit } from "../records";
import { codeForm } from "./tokens-page";

/** What a token of each scope may do, as the page says it. */
const GRANTS = {
  admin: "An admin: this computer may do everything you may.",
  publisher: "A publisher: this computer may publish, and manage only the sites it published.",
} as const;

/** What stands for the name of a computer that gave none. */
const NO_NAME = "It gave no name.";

/** The login a page shows. */
type Login = Extract<Awaited<ReturnType<typeof showLogin>>, { ok: true }>["login"];

function decisionForms(visit: Visit, login: Login): Html {
  return html`<form method="post" action="/tokens/allow">
${csrfField(visit)}
<input type="hidden" name="${CODE_KEY}" value="${login.code}">
<div class="field">
<label class="choice"><input type="checkbox" name="confirm" value="yes"> My computer shows the code ${login.code}</label>
</div>
<button type="submit">Allow</button>
</form>
<form method="post" action="/tokens/deny">
${csrfField(visit)}
<input type="hidden" name="${CODE_KEY}" value="${login.code}">
<button type="submit" class="danger">Deny</button>
</form>`;
}

/**
 * Show the login under the code in the address.
 *
 * A code of no pending login shows why, and the form to type another. Neither the secret nor any token is on the page.
 *
 * @returns the code, what the login would grant, the name the computer gave itself, and when it was asked, with a form that allows it once its box is ticked and one that denies it
 */
export async function showAllow(visit: Visit): Promise<Page> {
  const place = { tab: "tokens", heading: "Allow this computer?" } as const;
  const shown = await showLogin(visit.install, visit.actor, visit.url.searchParams.get(CODE_KEY) ?? "");
  if (!shown.ok) return { ...place, heading: "Log a computer in", body: html`<p class="notice refused" role="status">${refusalSentence(shown.code)}</p>${codeForm()}` };

  const { login } = shown;
  const body = html`<p class="code" aria-label="The code">${login.code}</p>
<p><strong>Allow only if this is the code on your computer.</strong> If someone sent you this address, the code is theirs: deny it.</p>
<dl>
<dt>It asks to be</dt><dd>${GRANTS[login.scope]}</dd>
<dt>It calls itself</dt><dd>${login.computer === "" ? NO_NAME : login.computer}</dd>
<dt>Asked</dt><dd>${showMoment(login.asked)}</dd>
<dt>Runs out</dt><dd>${showMoment(login.expires)}</dd>
</dl>
${decisionForms(visit, login)}`;

  return { ...place, body };
}
