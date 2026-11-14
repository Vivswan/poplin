// The Tokens tab: where a computer is logged in, and every token the install keeps, each with a way to revoke it.

import { listTokens } from "@poplin/core/src/actions/manage-tokens";
import { ALLOW_PAGE, CODE_KEY } from "@poplin/core/src/api/routes";
import { html } from "hono/html";

import { showMoment } from "../page/amounts";
import { csrfField, refusedPage } from "../page/frame";
import type { Html, Page, Visit } from "../records";

/** One token of the list. */
type Token = Extract<Awaited<ReturnType<typeof listTokens>>, { ok: true }>["tokens"][number];

function expiryCell(token: Token): Html {
  return token.expires === "never" ? html`never` : showMoment(token.expires);
}

function tokenRow(visit: Visit, token: Token): Html {
  return html`<tr>
<td class="wrap">${token.note === "" ? "no name" : token.note}</td>
<td>${token.scope}</td>
<td><code>${token.id}</code></td>
<td>${showMoment(token.created)}</td>
<td>${expiryCell(token)}</td>
<td><form method="post" action="/tokens/revoke">${csrfField(visit)}<input type="hidden" name="token" value="${token.id}"><button type="submit" class="danger" aria-label="Revoke the token ${token.id}">Revoke</button></form></td>
</tr>`;
}

/**
 * The form a code is typed into.
 *
 * @returns a form that opens the page where the login under the typed code is allowed or denied; it changes nothing itself
 */
export function codeForm(): Html {
  return html`<form method="get" action="${ALLOW_PAGE}">
<div class="field">
<label for="${CODE_KEY}">The code on the computer</label>
<input type="text" id="${CODE_KEY}" name="${CODE_KEY}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="WDJB-MJHT">
</div>
<button type="submit">Look at the login</button>
</form>`;
}

/**
 * Show the tokens.
 *
 * @returns the way to log a computer in, then every token, the newest first: its name, its role, its id, when it was made, and when it runs out, each with a button that revokes it. No token and no hash is on the page
 */
export async function showTokens(visit: Visit): Promise<Page> {
  const place = { tab: "tokens", heading: "Tokens" } as const;
  const listed = await listTokens(visit.install, visit.actor);
  if (!listed.ok) return refusedPage(place, listed);

  const body = html`<h2>Log a computer in</h2>
<p>On the computer, run <code>poplin login --server ${visit.url.origin}</code>. It prints an address to open and a code. With the code alone, type it here.</p>
${codeForm()}
<h2>Tokens</h2>
<p>A token is what a logged-in computer or an agent presents. A revoked token works nowhere from that moment on.</p>
<div class="scroll" role="region" aria-label="Tokens" tabindex="0"><table>
<thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Id</th><th scope="col">Made</th><th scope="col">Runs out</th><th scope="col">Revoke</th></tr></thead>
<tbody>${listed.tokens.map((token) => tokenRow(visit, token))}</tbody>
</table></div>`;

  return { ...place, body };
}
