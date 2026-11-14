// One site's own page: what it is, every setting, and every change the owner can make to it.

import { getSite } from "@poplin/core/src/actions/show";
import { showBytes } from "@poplin/core/src/records/settings";
import { parseUploadId } from "@poplin/core/src/records/upload";
import { showViews } from "@poplin/core/src/records/views";
import { html } from "hono/html";

import { showMoment } from "../page/amounts";
import { csrfField, refusedPage } from "../page/frame";
import type { Html, Page, Visit } from "../records";

/** Who may open a site under each access, in the words of the form. */
const ACCESSES = [
  { access: "private", means: "private: only you, after the login" },
  { access: "unlisted", means: "unlisted: anyone who has the address" },
  { access: "public", means: "public: everyone, also under a public name" },
] as const;

/** A count as a copy's progress carries it in the address. */
const COUNT_PATTERN = /^[0-9]{1,9}$/;

/** A site as the show action answers with it. */
type Shown = Extract<Awaited<ReturnType<typeof getSite>>, { ok: true }>["site"];

function checked(on: boolean): Html {
  return on ? html` checked` : html``;
}

function action(site: Shown, change: string): string {
  return `/sites/${encodeURIComponent(site.label)}/${change}`;
}

function expiry(site: Shown): Html {
  return site.expires === "never" ? html`never` : showMoment(site.expires);
}

/** About how often the site's pages were opened; the words say that the numbers are estimates. */
function opened(site: Shown): Html {
  if (site.views === null) return html`not known`;

  return html`${showViews(site.views.today)} times today, ${showViews(site.views.week)} in the last 7 days. Counted from a sample: opens of a page, not people.`;
}

function facts(site: Shown): Html {
  const versions = site.versions.map((version) => (version.number === site.live_version ? `v${version.number} (live)` : `v${version.number}`)).join(", ");
  const publicAddress = site.addresses.public === null ? html`` : html`<dt>Public address</dt><dd><a href="${site.addresses.public}" rel="noreferrer">${site.addresses.public}</a></dd>`;
  const gone = site.gone_on === undefined ? html`` : html`<dt>In the trash until</dt><dd>${showMoment(site.gone_on)}</dd>`;

  return html`<dl>
<dt>Address</dt><dd><a href="${site.addresses.site}" rel="noreferrer">${site.addresses.site}</a></dd>
${publicAddress}
<dt>Label</dt><dd><code>${site.label}</code></dd>
<dt>Access</dt><dd>${site.access}</dd>
<dt>Title</dt><dd>${site.title ?? "none"}</dd>
<dt>Kept versions</dt><dd>${versions}</dd>
<dt>Size</dt><dd>${showBytes(site.bytes)}, ${site.files} files</dd>
<dt>Pages opened</dt><dd>${opened(site)}</dd>
<dt>Updated</dt><dd>${showMoment(site.updated)}</dd>
<dt>Expires</dt><dd>${expiry(site)}</dd>
${gone}
</dl>`;
}

function accessChoice(site: Shown, choice: (typeof ACCESSES)[number]): Html {
  return html`<label class="choice"><input type="radio" name="access" value="${choice.access}"${checked(site.access === choice.access)}> ${choice.means}</label>`;
}

function settingsForm(visit: Visit, site: Shown): Html {
  return html`<h2>Settings</h2>
<form method="post" action="${action(site, "settings")}">
${csrfField(visit)}
<div class="field">
<label for="name">Name</label>
<input type="text" id="name" name="name" value="${site.name}" autocomplete="off">
<p class="hint">A new name changes the label. The id stays, so no link breaks.</p>
</div>
<fieldset>
<legend>Access</legend>
${ACCESSES.map((choice) => accessChoice(site, choice))}
<p class="hint">A private site's address holds -p-, every other -u-: a change to or from private changes the address.</p>
<div class="field when-public">
<label for="public_name">Public name</label>
<input type="text" id="public_name" name="public_name" value="${site.public_name ?? ""}" autocomplete="off">
<p class="hint">Left empty, a public site keeps its public name, and a site going public takes its own name.</p>
</div>
</fieldset>
<div class="field">
<label for="title">Title</label>
<input type="text" id="title" name="title" value="${site.title_typed ? site.title : ""}" autocomplete="off">
<p class="hint">Left empty, the site shows its page's own title.</p>
</div>
<div class="field">
<label class="choice"><input type="checkbox" name="search_engines" value="on"${checked(site.search_engines)}> Search engines may list this site</label>
<label class="choice"><input type="checkbox" name="embeddable" value="on"${checked(site.embeddable)}> Other pages may show this site in a frame</label>
</div>
<div class="field">
<label for="expires">Expires</label>
<input type="text" id="expires" name="expires" value="" autocomplete="off">
<p class="hint">Now: ${expiry(site)}. Type <code>never</code>, a span such as <code>7d</code>, or a day such as <code>2026-12-01</code>. Left empty, it stays.</p>
</div>
<button type="submit">Save settings</button>
</form>`;
}

function rollbackForm(visit: Visit, site: Shown): Html {
  const others = site.versions.filter((version) => version.number !== site.live_version);
  if (others.length === 0) return html`<h2>Roll back</h2><p>Only one version is kept, so there is nothing to go back to.</p>`;

  const hasLower = others.some((version) => version.number < site.live_version);
  const previous = hasLower ? html`<option value="previous">the one before v${site.live_version}</option>` : html``;

  return html`<h2>Roll back</h2>
<form method="post" action="${action(site, "rollback")}">
${csrfField(visit)}
<div class="field">
<label for="version">Make this version the live one</label>
<select id="version" name="version">
${previous}
${others.map((version) => html`<option value="${version.number}">v${version.number}</option>`)}
</select>
<p class="hint">Only the content changes. The settings and the address stay.</p>
</div>
<button type="submit">Roll back</button>
</form>`;
}

/** The form that begins a copy; or, on the page a copy in progress came back to, the form that goes on with it. */
function duplicateForm(visit: Visit, site: Shown): Html {
  const upload = parseUploadId(visit.url.searchParams.get("copy") ?? "");
  const [copied, files] = [visit.url.searchParams.get("copied") ?? "", visit.url.searchParams.get("files") ?? ""];

  if (upload !== undefined && COUNT_PATTERN.test(copied) && COUNT_PATTERN.test(files)) {
    return html`<h2>Duplicate</h2>
<form method="post" action="${action(site, "duplicate")}">
${csrfField(visit)}
<input type="hidden" name="upload" value="${upload}">
<p>Copying: ${copied} of ${files} files. The copy is no site until every file is there.</p>
<button type="submit">Keep copying</button>
</form>`;
  }

  return html`<h2>Duplicate</h2>
<form method="post" action="${action(site, "duplicate")}">
${csrfField(visit)}
<p>Makes a private copy of the live version, with a new address. This site is not changed.</p>
<div class="field">
<label for="copy_name">Name of the copy</label>
<input type="text" id="copy_name" name="name" value="" autocomplete="off">
<p class="hint">Left empty, it is this site's name.</p>
</div>
<button type="submit">Duplicate</button>
</form>`;
}

function liveForms(visit: Visit, site: Shown): Html {
  return html`${settingsForm(visit, site)}
${rollbackForm(visit, site)}
${duplicateForm(visit, site)}
<h2>New link</h2>
<form method="post" action="${action(site, "new-link")}">
${csrfField(visit)}
<p>The site gets a new id, so a new address. The current address stops working at once. A public name keeps working.</p>
<button type="submit" class="danger">Make a new link</button>
</form>
<h2>Delete</h2>
<form method="post" action="${action(site, "delete")}">
${csrfField(visit)}
<p>The site goes to the trash and stops being served. It can be restored from there.</p>
<button type="submit" class="danger">Move to the trash</button>
</form>`;
}

function trashForms(visit: Visit, site: Shown): Html {
  return html`<h2>Restore</h2>
<form method="post" action="${action(site, "restore")}">
${csrfField(visit)}
<p>The site comes back with its address and its settings. An expiry that has passed is cleared.</p>
<button type="submit">Restore</button>
</form>
<h2>Delete forever</h2>
<form method="post" action="${action(site, "delete-forever")}">
${csrfField(visit)}
<div class="field">
<label for="confirm">Type the site's label to confirm</label>
<input type="text" id="confirm" name="confirm" value="" autocomplete="off">
<p class="hint">The label is <code>${site.label}</code>. The site and its files are removed now and cannot be brought back.</p>
</div>
<button type="submit" class="danger">Delete forever</button>
</form>`;
}

/**
 * Show one site, in the trash or not.
 *
 * @param reference - the site's label from the address; the show action reads it
 * @returns the site's facts with the forms of a live site, or those of a site in the trash; a 404 page with the refusal's sentence when no site is shown
 */
export async function showSite(visit: Visit, reference: string): Promise<Page> {
  const shown = await getSite(visit.install, visit.actor, reference);
  if (!shown.ok) return refusedPage({ tab: "sites", heading: "Site", status: 404 }, shown);

  const { site } = shown;
  const forms = site.state === "trash" ? trashForms(visit, site) : liveForms(visit, site);
  const body = html`<p><a href="${site.state === "trash" ? "/?view=trash" : "/"}">All sites</a></p>
${facts(site)}
${forms}`;

  return { tab: "sites", heading: site.name, body };
}
