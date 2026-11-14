// The Sites tab: every site in a table, the one changed last first, or the trash.

import { listSites } from "@poplin/core/src/actions/list";
import { showBytes } from "@poplin/core/src/records/settings";
import { html } from "hono/html";

import { showMoment } from "../page/amounts";
import { refusedPage } from "../page/frame";
import type { Html, Page, Visit } from "../records";

/** How many sites one page of the table holds. */
const PAGE_SIZE = 25;

/** The place a page of the list ended, as the address carries it: the change time, a dash, the id. */
const CURSOR_PATTERN = /^([0-9]{1,16})-([0-9a-z]{12})$/;

/** A site as the list action answers with it. */
type Listed = Extract<Awaited<ReturnType<typeof listSites>>, { ok: true }>;

/** One site of a page. */
type Row = Listed["sites"][number];

function cursorIn(url: URL): unknown {
  const after = url.searchParams.get("after");
  if (after === null) return undefined;

  const [, updated, id] = CURSOR_PATTERN.exec(after) ?? [];
  if (updated === undefined) return after;

  return { updated_at: Number(updated), id };
}

function listPath(trash: boolean, after?: Listed["next"]): string {
  const query = new URLSearchParams();
  if (trash) query.set("view", "trash");

  if (after !== undefined) query.set("after", `${after.updated_at}-${after.id}`);

  const text = query.toString();

  return text === "" ? "/" : `/?${text}`;
}

function viewSwitch(trash: boolean): Html {
  const active = trash ? html`<a href="/">Active</a>` : html`<a href="/" aria-current="page">Active</a>`;
  const trashed = trash ? html`<a href="/?view=trash" aria-current="page">Trash</a>` : html`<a href="/?view=trash">Trash</a>`;

  return html`<nav aria-label="Which sites"><ul><li>${active}</li><li>${trashed}</li></ul></nav>`;
}

function siteRow(site: Row): Html {
  return html`<tr>
<td><a href="/sites/${encodeURIComponent(site.label)}">${site.name}</a></td>
<td class="wrap"><a href="${site.url}" rel="noreferrer">${site.url.replace(/^https:\/\//, "")}</a></td>
<td>${site.access}</td>
<td class="wrap">${site.title ?? ""}</td>
<td>${showBytes(site.bytes)}, ${site.files} files</td>
<td>v${site.live_version}</td>
<td>${showMoment(site.updated)}</td>
</tr>`;
}

function sitesTable(sites: readonly Row[], trash: boolean): Html {
  if (sites.length === 0) return html`<p>${trash ? "The trash is empty." : "No sites here."}</p>`;

  return html`<div class="scroll" role="region" aria-label="Sites" tabindex="0"><table>
<thead><tr><th scope="col">Name</th><th scope="col">Address</th><th scope="col">Access</th><th scope="col">Title</th><th scope="col">Size</th><th scope="col">Live</th><th scope="col">Updated</th></tr></thead>
<tbody>${sites.map(siteRow)}</tbody>
</table></div>`;
}

function paging(trash: boolean, onFirst: boolean, next: Listed["next"]): Html {
  const first = onFirst ? html`` : html`<a href="${listPath(trash)}">First page</a> `;
  const following = next === undefined ? html`` : html`<a href="${listPath(trash, next)}">Next page</a>`;

  return html`<p>${first}${following}</p>`;
}

/**
 * Show one page of the sites, or of the trash with `view=trash`.
 *
 * @returns the table, a switch between the two lists, and the links to the first and the next page; `after` in the address is the list action's cursor
 */
export async function showSites(visit: Visit): Promise<Page> {
  const place = { tab: "sites", heading: "Sites" } as const;
  const trash = visit.url.searchParams.get("view") === "trash";
  const after = cursorIn(visit.url);

  // The action checks the cursor, so anything the address holds is handed over as it is.
  const listed = await listSites(visit.install, visit.actor, { trash, limit: PAGE_SIZE, after } as Parameters<typeof listSites>[2]);
  if (!listed.ok) return refusedPage(place, listed);

  const body = html`${viewSwitch(trash)}
${sitesTable(listed.sites, trash)}
${paging(trash, after === undefined, listed.next)}`;

  return { ...place, body };
}
