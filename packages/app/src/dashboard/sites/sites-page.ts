// The Sites page: every site in one table, the one changed last first, with a search box and a filter by who can open it; or the trash. One site opens in a panel beside the table.

import { listSites } from "@poplin/core/src/actions/list";
import { listTokens } from "@poplin/core/src/actions/manage-tokens";
import { getSite } from "@poplin/core/src/actions/show";
import { html } from "hono/html";

import { showMoment } from "../page/amounts";
import { csrfField, refusedPage } from "../page/frame";
import { ICONS } from "../page/icons";
import { noticeIn } from "../page/notices";
import type { Html, Page, Visit } from "../records";
import { ACCESSES } from "./access";
import { shownAddress } from "./address";
import { type PanelContext, sitePanel } from "./site-panel";

/** How many sites one page of the table holds. */
const PAGE_SIZE = 25;

/** The place a page of the list ended, as the address carries it: the change time, a dash, the id. */
const CURSOR_PATTERN = /^([0-9]{1,16})-([0-9a-z]{12})$/;

/** The filters above the table, in the order shown. Each but the first narrows the table to one access, and the last shows the trash. */
const FILTERS = [{ key: "all", label: "All sites" }, ...ACCESSES.map((entry) => ({ key: entry.access, label: entry.label })), { key: "trash", label: "Trash" }] as const;

/** The most characters a site's name holds: a longer search matches no site. */
const MAX_SEARCH = 40;

/** The answer to a search no site can match. */
const NOTHING: Listed = { ok: true, sites: [] };

/** A site as the list action answers with it. */
type Listed = Extract<Awaited<ReturnType<typeof listSites>>, { ok: true }>;

/** One site of a page. */
type Row = Listed["sites"][number];

/** Which filter the table is under. */
type Filter = (typeof FILTERS)[number]["key"];

/** What the address asks of the table: its filter, the text its names are searched for, and the place its page begins after, as the address carries it. */
interface Shown {
  readonly filter: Filter;
  readonly search: string;
  readonly after?: string;
}

function shownIn(url: URL): Shown {
  const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const after = url.searchParams.get("after") ?? "";
  const place = CURSOR_PATTERN.test(after) ? { after } : {};
  if (url.searchParams.get("view") === "trash") return { filter: "trash", search, ...place };

  const access = url.searchParams.get("access");
  const filter = FILTERS.find((entry) => entry.key === access)?.key ?? "all";

  return { filter: filter === "trash" ? "all" : filter, search, ...place };
}

function cursorIn(url: URL): unknown {
  const after = url.searchParams.get("after");
  if (after === null) return undefined;

  const [, updated, id] = CURSOR_PATTERN.exec(after) ?? [];
  if (updated === undefined) return after;

  return { updated_at: Number(updated), id };
}

/** The query that keeps the table as it is shown: its filter, its search, and the page it is on. */
function queryOf(shown: Shown): URLSearchParams {
  const query = new URLSearchParams();
  if (shown.filter === "trash") query.set("view", "trash");
  else if (shown.filter !== "all") query.set("access", shown.filter);

  if (shown.search !== "") query.set("q", shown.search);

  if (shown.after !== undefined) query.set("after", shown.after);

  return query;
}

function pathOf(path: string, query: URLSearchParams): string {
  const text = query.toString();

  return text === "" ? path : `${path}?${text}`;
}

/** The path of the table as shown, on the page it is on. */
function listPath(shown: Shown): string {
  return pathOf("/", queryOf(shown));
}

/** The path of the table's first page under a filter and a search, or of the page that follows `after`. */
function pagePath(shown: Shown, after?: Listed["next"]): string {
  return listPath({ filter: shown.filter, search: shown.search, ...(after === undefined ? {} : { after: `${after.updated_at}-${after.id}` }) });
}

/** The one filter control: it names the filter the table is under, and opens the others. */
function filterMenu(shown: Shown): Html {
  const current = FILTERS.find((entry) => entry.key === shown.filter)?.label ?? "";
  const links = FILTERS.map((entry) => {
    const path = pagePath({ filter: entry.key, search: shown.search });

    return entry.key === shown.filter ? html`<a href="${path}" aria-current="true">${entry.label}</a>` : html`<a href="${path}">${entry.label}</a>`;
  });

  return html`<details class="menu filter"><summary aria-label="Which sites: ${current}">${current}${ICONS.down}</summary><nav class="pop" aria-label="Which sites">${links}</nav></details>`;
}

/** The search box. It is a form of its own, sent with Enter, and keeps the filter the table is under. */
function searchBox(shown: Shown, focused: boolean): Html {
  const kept = Array.from(queryOf({ filter: shown.filter, search: "" }), ([name, value]) => html`<input type="hidden" name="${name}" value="${value}">`);
  const clear = shown.search === "" ? html`` : html`<a class="txt" href="${pagePath({ filter: shown.filter, search: "" })}">Clear</a>`;

  const focus = focused ? html` autofocus` : html``;

  return html`<form class="find" method="get" action="/" role="search">${kept}
<input type="search" name="q" value="${shown.search}" maxlength="${MAX_SEARCH}" placeholder="Find a site" aria-label="Find a site by name"${focus}>${clear}</form>`;
}

function accessMark(site: Row): Html {
  return html`<span class="st ${site.access}">${ICONS[site.access]}${ACCESSES.find((entry) => entry.access === site.access)?.label ?? ""}</span>`;
}

function sitePath(site: Row, shown: Shown, extra?: Readonly<Record<string, string>>): string {
  const query = queryOf(shown);
  for (const [name, value] of Object.entries(extra ?? {})) query.set(name, value);

  return pathOf(`/sites/${encodeURIComponent(site.label)}`, query);
}

/** The query a row's delete form carries: that it was sent from the table, and the filter and the search to come back to. */
function deleteQuery(shown: Shown): URLSearchParams {
  return new URLSearchParams([["from", "list"], ...queryOf({ filter: shown.filter, search: shown.search })]);
}

/** The menu at a row's end: what is done to a site without opening it, and the ways into its panel. */
function rowMenu(visit: Visit, site: Row, shown: Shown): Html {
  return html`<details class="menu" name="row-menu"><summary aria-label="More for ${site.name}">${ICONS.more}</summary><div class="pop">
<a href="${site.url}" rel="noreferrer">Open</a>
<a href="${sitePath(site, shown, { ask: "rename" })}">Rename</a>
<a href="${sitePath(site, shown, { ask: "duplicate" })}">Duplicate</a>
<a href="${sitePath(site, shown, { ask: "new-link" })}">New link</a>
<form method="post" action="${pathOf(`/sites/${encodeURIComponent(site.label)}/delete`, deleteQuery(shown))}">${csrfField(visit)}<button type="submit" class="danger">Delete</button></form>
</div></details>`;
}

function siteRow(visit: Visit, site: Row, shown: Shown, open: string | undefined): Html {
  const selected = site.label === open;

  return html`<li${selected ? html` class="sel"` : html``}>
<span class="name"><a href="${selected ? listPath(shown) : sitePath(site, shown)}" title="${site.name}"${selected ? html` aria-expanded="true"` : html``}>${site.name}</a>${accessMark(site)}</span>
<span><span class="sr">Who can open it: </span>${accessMark(site)}</span>
<span class="lkc"><span class="sr">Link: </span>${shownAddress(site)}</span>
<span class="soft"><span class="sr">Updated: </span>${showMoment(site.updated)}</span>
<span class="acts on"><button type="button" class="ic" hidden data-copy="${site.url}" aria-label="Copy the link of ${site.name}">${ICONS.copy}</button>${rowMenu(visit, site, shown)}</span>
</li>`;
}

function trashRow(visit: Visit, site: Row, shown: Shown, open: string | undefined): Html {
  const gone = site.gone_on === undefined ? html`` : html`<span class="sr">Gone for good: </span>${showMoment(site.gone_on)}`;

  return html`<li class="tr${site.label === open ? " sel" : ""}">
<span class="name"><a href="${sitePath(site, shown)}" title="${site.name}">${site.name}</a></span>
<span class="lkc soft">${gone}</span>
<span class="acts on"><form method="post" action="/sites/${encodeURIComponent(site.label)}/restore">${csrfField(visit)}<button type="submit" aria-label="Restore ${site.name}">Restore</button></form></span>
</li>`;
}

function emptyLine(shown: Shown): string {
  if (shown.search !== "") return `No sites match "${shown.search}".`;

  if (shown.filter === "trash") return "The trash is empty.";

  return shown.filter === "all" ? "No sites yet. An agent or the command below publishes the first." : `No ${shown.filter} sites.`;
}

function sitesTable(visit: Visit, sites: readonly Row[], shown: Shown, open: string | undefined): Html {
  if (sites.length === 0) return html`<p class="empty">${emptyLine(shown)}</p>`;

  if (shown.filter === "trash") {
    return html`<ul class="rows sites" aria-label="Sites in the trash">
<li class="th tr" aria-hidden="true"><span>Name</span><span>Gone for good</span><span></span></li>
${sites.map((site) => trashRow(visit, site, shown, open))}
</ul>`;
  }

  return html`<ul class="rows sites" aria-label="Sites">
<li class="th" aria-hidden="true"><span>Name</span><span>Who can open it</span><span>Link</span><span>Updated</span><span></span></li>
${sites.map((site) => siteRow(visit, site, shown, open))}
</ul>`;
}

/** The line under the table: the way to the next page, and how a new site is made. */
function footLine(shown: Shown, onFirst: boolean, next: Listed["next"]): Html {
  const first = onFirst ? html`` : html`<a href="${pagePath(shown)}">First page</a>`;
  const following = next === undefined ? html`` : html`<a href="${pagePath(shown, next)}" rel="next">Next page</a>`;
  const made = shown.filter === "trash" ? html`<span>A site leaves the trash for good on the day shown.</span>` : html`<span>New site: <code>npx poplin ./my-folder</code></span>`;

  return html`<p class="foot">${first}${following}${made}</p>`;
}

/** What the panel is shown with: the question the address asks, the tokens' names, and the reason of a refused rename, which the panel says at its field. */
async function panelContext(visit: Visit): Promise<PanelContext> {
  const ask = visit.url.searchParams.get("ask");
  const tokens = await listTokens(visit.install, visit.actor);
  const publishers = new Map(tokens.ok ? tokens.tokens.filter((token) => token.note !== "").map((token) => [token.id, token.note]) : []);
  const notice = ask === "rename" ? noticeIn(visit.url) : undefined;
  if (notice?.kind !== "refused") return { ask, publishers };

  return { ask, publishers, refusal: notice.text };
}

/**
 * Show one page of the sites, or of the trash with `view=trash`, and one site's panel beside it.
 *
 * @param reference - the label of the site to open, from the address; left out, no panel is shown
 * @returns the table under the filter and the search the address names; `after` in the address is the list action's cursor. A 404 page with the refusal's sentence when the site to open is not shown
 */
export async function showSites(visit: Visit, reference?: string): Promise<Page> {
  const place = { tab: "sites", heading: "Sites" } as const;
  const opened = reference === undefined ? undefined : await getSite(visit.install, visit.actor, reference);
  if (opened !== undefined && !opened.ok) return refusedPage({ ...place, heading: "Site", status: 404 }, opened);

  const asked = shownIn(visit.url);
  const shown: Shown = opened?.site.state === "trash" ? { ...asked, filter: "trash" } : asked;
  const after = cursorIn(visit.url);
  const narrowed = { ...(shown.search === "" ? {} : { named: shown.search }), ...(shown.filter === "all" || shown.filter === "trash" ? {} : { access: shown.filter }) };

  // The action checks the cursor, so what the address holds is handed over as it is. A search longer than any name is not asked: it matches nothing.
  const query = { trash: shown.filter === "trash", limit: PAGE_SIZE, after, ...narrowed } as Parameters<typeof listSites>[2];
  const listed = shown.search.length > MAX_SEARCH ? NOTHING : await listSites(visit.install, visit.actor, query);
  if (!listed.ok) return refusedPage(place, listed);

  const body = html`<div class="tools">${searchBox(shown, shown.search !== "" && opened === undefined)}${filterMenu(shown)}</div>
${sitesTable(visit, listed.sites, shown, opened?.site.label)}
${footLine(shown, after === undefined, listed.next)}`;
  if (opened === undefined) return { ...place, body };

  const context = await panelContext(visit);

  return { ...place, body, panel: { body: sitePanel(visit, opened.site, pathOf("", queryOf(shown)), context), back: listPath(shown) }, ownNotice: context.refusal !== undefined && opened.site.state !== "trash" };
}
