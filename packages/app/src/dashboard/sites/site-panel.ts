// One site's panel, beside the table: its link, who can open it, what it is, its versions, and every change the owner can make to it.

import { copiesPerCall } from "@poplin/core/src/actions/duplicate";
import type { getSite } from "@poplin/core/src/actions/show";
import { showBytes } from "@poplin/core/src/records/settings";
import { parseUploadId } from "@poplin/core/src/records/upload";
import { showViews } from "@poplin/core/src/records/views";
import { html } from "hono/html";

import { showMoment } from "../page/amounts";
import { csrfField } from "../page/frame";
import { ICONS } from "../page/icons";
import type { Html, Visit } from "../records";
import { ACCESSES } from "./access";
import { hidesId, shownAddress } from "./address";

/** The id of the question a panel is asked to show. */
const QUESTION_ID = "ask";

/** A count as a copy's progress carries it in the address. */
const COUNT_PATTERN = /^[0-9]{1,9}$/;

/** A site as the show action answers with it. */
type Shown = Extract<Awaited<ReturnType<typeof getSite>>, { ok: true }>["site"];

/** What a panel is shown with, beside its site. */
export interface PanelContext {
  /** The question the address asks the panel to show. */
  readonly ask: string | null;

  /** The name of each token, by its id: a version published by a token shows the name. */
  readonly publishers: ReadonlyMap<string, string>;

  /** Why the rename that led here was refused, said at its field. */
  readonly refusal?: string;
}

/** One access a site may have. */
type Access = (typeof ACCESSES)[number];

function checked(on: boolean): Html {
  return on ? html` checked` : html``;
}

function action(site: Shown, change: string): string {
  return `/sites/${encodeURIComponent(site.label)}/${change}`;
}

/** The panel's own address, with the table's filter and search kept, and what the panel is asked to show. */
function here(site: Shown, carry: string, ask?: string): string {
  const path = `/sites/${encodeURIComponent(site.label)}${carry}`;
  if (ask === undefined) return path;

  return `${path}${carry === "" ? "?" : "&"}ask=${ask}`;
}

/** The panel's first line: the site's name, which takes the focus when the panel opens, or the field that renames it, holding what was typed when a name was refused. */
function head(visit: Visit, site: Shown, carry: string, context: PanelContext): Html {
  const close = html`<a class="ic end close" href="/${carry}" aria-label="Close">${ICONS.close}</a>`;
  if (context.ask !== "rename") {
    const focus = context.ask === null ? html` autofocus` : html``;

    return html`<div class="title"><h2 tabindex="-1"${focus}>${site.name}</h2><a class="ic" href="${here(site, carry, "rename")}" aria-label="Rename">${ICONS.rename}</a>${close}</div>`;
  }

  const refused = context.refusal === undefined ? html`` : html`<p class="hint bad" role="alert">${context.refusal}</p>`;

  return html`<form method="post" action="${action(site, "rename")}" class="title" id="${QUESTION_ID}">${csrfField(visit)}
<input type="text" name="name" value="${visit.url.searchParams.get("name") ?? site.name}" aria-label="Name" autocomplete="off" autofocus>
<button type="submit" class="pri f">Save</button><a class="btn f" href="${here(site, carry)}">Cancel</a>${close}
</form>
${refused}<p class="hint">The link takes the new name. The old link keeps working.</p>`;
}

/** The site's link. An unlisted site's id is the key to it, so it is shown only when asked for; the copy button gives the whole link either way. */
function linkBlock(site: Shown): Html {
  const whole = hidesId(site) ? html`<details><summary>Show the whole link</summary>${shownAddress(site, true)}</details>` : html``;
  const other = site.addresses.public === null ? html`` : html`<p class="hint">It also opens at <span class="lk">${site.addresses.site.replace(/^https:\/\//, "")}</span></p>`;

  return html`<div class="blk"><p class="lab">Link</p>
<div class="line">${shownAddress(site)}<button type="button" class="pri" hidden data-copy="${site.url}">Copy</button><a class="btn" href="${site.url}" rel="noreferrer">Open</a></div>
${whole}${other}</div>`;
}

/** One choice of who can open the site: the one it has, a button for a more private one, and a link to the question for a less private one. */
function accessChoice(visit: Visit, site: Shown, carry: string, choice: Access): Html {
  const now = ACCESSES.findIndex((entry) => entry.access === site.access);
  const then = ACCESSES.indexOf(choice);
  if (then === now) return html`<span aria-current="true">${ICONS[choice.access]}${choice.label}</span>`;

  if (then > now) return html`<a href="${here(site, carry, choice.access)}">${ICONS[choice.access]}${choice.label}</a>`;

  return html`<form method="post" action="${action(site, "access")}">${csrfField(visit)}<input type="hidden" name="access" value="${choice.access}"><button type="submit">${ICONS[choice.access]}${choice.label}</button></form>`;
}

/** The question before a site is opened to more people. */
function accessQuestion(visit: Visit, site: Shown, carry: string, ask: string | null): Html {
  const now = ACCESSES.findIndex((entry) => entry.access === site.access);
  const wanted = ACCESSES.find((entry, index) => entry.access === ask && index > now);
  if (wanted === undefined) return html``;

  const publicName =
    wanted.access === "public"
      ? html`<label for="public_name">Public link name</label><input type="text" id="public_name" name="public_name" value="" placeholder="${site.name}" autocomplete="off"><span class="hint">Left empty, it is the site's own name.</span>`
      : html``;

  return html`<form method="post" action="${action(site, "access")}" class="ask" id="${QUESTION_ID}">${csrfField(visit)}<input type="hidden" name="access" value="${wanted.access}">
<span>${wanted.means}</span>${publicName}
<span class="line"><button type="submit" class="pri" autofocus>Make it ${wanted.access}</button><a class="btn" href="${here(site, carry)}">Cancel</a></span>
</form>`;
}

function whoBlock(visit: Visit, site: Shown, carry: string, ask: string | null): Html {
  const means = ACCESSES.find((entry) => entry.access === site.access)?.means ?? "";

  return html`<div class="blk"><p class="lab">Who can open it</p>
<div class="seg">${ACCESSES.map((choice) => accessChoice(visit, site, carry, choice))}</div>
<p class="hint">${means}</p>
${accessQuestion(visit, site, carry, ask)}</div>`;
}

function expiry(site: Shown): Html {
  return site.expires === "never" ? html`Never` : showMoment(site.expires);
}

/** About how often the site's pages were opened; the words say that the numbers are estimates. */
function opened(site: Shown): Html {
  if (site.views === null) return html`Not known`;

  return html`${showViews(site.views.today)} today, ${showViews(site.views.week)} in 7 days`;
}

function factsBlock(site: Shown): Html {
  const gone = site.gone_on === undefined ? html`` : html`<dt>Gone for good</dt><dd>${showMoment(site.gone_on)}</dd>`;

  return html`<div class="blk"><dl class="facts">
<dt>Title</dt><dd>${site.title ?? "None"}</dd>
<dt>Views</dt><dd>${opened(site)}</dd>
<dt>Size</dt><dd>${showBytes(site.bytes)}, ${site.files} files</dd>
<dt>Updated</dt><dd>${showMoment(site.updated)}</dd>
<dt>Deletes itself</dt><dd>${expiry(site)}</dd>
${gone}
</dl></div>`;
}

function versionRow(visit: Visit, site: Shown, version: Shown["versions"][number], context: PanelContext): Html {
  const live = version.number === site.live_version;
  const restore = live
    ? html`<span></span>`
    : html`<form method="post" action="${action(site, "rollback")}">${csrfField(visit)}<input type="hidden" name="version" value="${version.number}"><button type="submit" aria-label="Make version ${version.number} live">Make live</button></form>`;

  return html`<div class="ver"><b>v${version.number}</b><span class="live">${live ? "live" : ""}</span><span class="soft">${showMoment(version.published)}, ${context.publishers.get(version.published_by) ?? version.published_by}</span>${restore}</div>`;
}

function versionsBlock(visit: Visit, site: Shown, context: PanelContext): Html {
  const newestFirst = [...site.versions].sort((left, right) => right.number - left.number);

  return html`<div class="blk"><p class="lab">Versions</p>${newestFirst.map((version) => versionRow(visit, site, version, context))}</div>`;
}

/** How far a copy in progress is, and what one more press does. */
function copyProgress(copied: number, files: number): Html {
  const left = Math.max(0, files - copied);
  if (left === 0) return html`<p>Every file is copied. Press Keep copying once more to make the site.</p>`;

  return html`<p>Copied ${copied} of ${files} files: ${left} are left. Keep copying copies up to ${copiesPerCall(files)} more. The new site appears when every file is copied.</p>`;
}

/** The form that goes on with a copy in progress, and the one that cancels it. */
function copyingForms(visit: Visit, site: Shown, copy: { readonly upload: string; readonly copied: number; readonly files: number }): Html {
  return html`<form method="post" action="${action(site, "duplicate")}">
${csrfField(visit)}
<input type="hidden" name="upload" value="${copy.upload}">
${copyProgress(copy.copied, copy.files)}
<button type="submit" class="pri">Keep copying</button>
</form>
<form method="post" action="${action(site, "cancel-copy")}">
${csrfField(visit)}
<input type="hidden" name="upload" value="${copy.upload}">
<p class="hint">A copy that is not finished is removed after a day. Cancel removes it now. To copy a large site without pressing, cancel this copy and run <code>poplin duplicate ${site.label}</code> in a terminal.</p>
<button type="submit">Cancel the copy</button>
</form>`;
}

/** On the page a copy in progress came back to, the forms of that copy; nothing on any other. */
function copyingBlock(visit: Visit, site: Shown): Html {
  const upload = parseUploadId(visit.url.searchParams.get("copy") ?? "");
  const [copied, files] = [visit.url.searchParams.get("copied") ?? "", visit.url.searchParams.get("files") ?? ""];
  if (upload === undefined || !COUNT_PATTERN.test(copied) || !COUNT_PATTERN.test(files)) return html``;

  return html`<div class="blk"><p class="lab">Duplicate</p>${copyingForms(visit, site, { upload, copied: Number(copied), files: Number(files) })}</div>`;
}

/** The question a link of the last block opens: the name of a copy, or whether the long link is to change. */
function lastQuestion(visit: Visit, site: Shown, carry: string, ask: string | null): Html {
  const cancel = html`<a class="btn" href="${here(site, carry)}">Cancel</a>`;

  if (ask === "duplicate") {
    return html`<form method="post" action="${action(site, "duplicate")}" class="ask" id="${QUESTION_ID}">${csrfField(visit)}
<label for="copy_name">Name of the copy</label>
<input type="text" id="copy_name" name="name" value="" autocomplete="off" autofocus>
<span>A private copy of the live version, with its own link. Left empty, it takes this site's name.</span>
<span class="line"><button type="submit" class="pri">Duplicate</button>${cancel}</span>
</form>`;
  }

  if (ask !== "new-link") return html``;

  return html`<form method="post" action="${action(site, "new-link")}" class="ask" id="${QUESTION_ID}">${csrfField(visit)}
<span>The site gets a new link. The link in use now stops working at once. A public site's public link keeps working.</span>
<span class="line"><button type="submit" class="pri" autofocus>Make a new link</button>${cancel}</span>
</form>`;
}

/** The settings a site is seldom given, folded away: a public site's short link name, its title, what search engines and other pages may do with it, and when it deletes itself. */
function moreSettings(visit: Visit, site: Shown): Html {
  const publicName =
    site.public_name === null
      ? html``
      : html`<div class="field">
<label for="short_name">Public link name</label>
<input type="text" id="short_name" name="public_name" value="${site.public_name}" autocomplete="off">
</div>`;

  return html`<div class="blk"><details><summary>More settings</summary>
<form method="post" action="${action(site, "settings")}">
${csrfField(visit)}
<input type="hidden" name="access" value="${site.access}">
${publicName}<div class="field">
<label for="title">Title</label>
<input type="text" id="title" name="title" value="${site.title_typed ? site.title : ""}" autocomplete="off">
<p class="hint">Left empty, the site shows its page's own title.</p>
</div>
<div class="field">
<label class="choice"><input type="checkbox" name="search_engines" value="on"${checked(site.search_engines)}> Search engines may list it</label>
<label class="choice"><input type="checkbox" name="embeddable" value="on"${checked(site.embeddable)}> Other websites may embed it</label>
</div>
<div class="field">
<label for="expires">Deletes itself</label>
<input type="text" id="expires" name="expires" value="" autocomplete="off">
<p class="hint">Now: ${expiry(site)}. Type <code>never</code>, a span such as <code>7d</code>, or a day such as <code>2026-12-01</code>. Left empty, it stays.</p>
</div>
<button type="submit" class="f">Save settings</button>
</form>
</details></div>`;
}

/** The filter and the search of the table beside the panel, as a delete form carries them: the page position is left out, since the table is one row shorter after. */
function tableQuery(carry: string): string {
  const kept = new URLSearchParams(carry);
  kept.delete("after");

  return kept.size === 0 ? "" : `?${kept}`;
}

/** What is done to the whole site: a copy and a new link, each asked about first, and the way to the trash, which can be undone from there. */
function lastBlock(visit: Visit, site: Shown, carry: string, ask: string | null): Html {
  return html`<div class="blk"><div class="line"><a class="txt" href="${here(site, carry, "duplicate")}">Duplicate</a><a class="txt" href="${here(site, carry, "new-link")}">New link</a>
<form method="post" action="${action(site, "delete")}${tableQuery(carry)}" class="end">${csrfField(visit)}<button type="submit" class="txt danger">Delete</button></form></div>
${lastQuestion(visit, site, carry, ask)}</div>`;
}

function trashBlocks(visit: Visit, site: Shown): Html {
  return html`<div class="blk"><p class="lab">In the trash</p>
<form method="post" action="${action(site, "restore")}">${csrfField(visit)}
<p class="hint">The site comes back with its link and its settings. A day to delete itself that has passed is cleared.</p>
<button type="submit" class="pri f">Restore</button>
</form></div>
<div class="blk"><p class="lab">Delete for good</p>
<form method="post" action="${action(site, "delete-forever")}">${csrfField(visit)}
<div class="field">
<label for="confirm">Type <code>${site.name}</code> to confirm</label>
<input type="text" id="confirm" name="confirm" value="" autocomplete="off" aria-describedby="confirm-hint">
<p class="hint" id="confirm-hint">The site and its files are removed now and cannot be brought back.</p>
</div>
<button type="submit" class="txt danger">Delete for good</button>
</form></div>`;
}

/**
 * Build the panel of one site, in the trash or not.
 *
 * @param carry - the query that keeps the table beside the panel as it is shown, with its `?`, or the empty string
 * @returns the panel; `ask` opens one question in it: `rename`, `unlisted`, `public`, `duplicate`, or `new-link`
 */
export function sitePanel(visit: Visit, site: Shown, carry: string, context: PanelContext): Html {
  const { ask } = context;
  if (site.state === "trash") {
    return html`<aside class="panel" aria-label="${site.name}"><div class="title"><h2 tabindex="-1" autofocus>${site.name}</h2><a class="ic end close" href="/${carry}" aria-label="Close">${ICONS.close}</a></div>
${factsBlock(site)}${trashBlocks(visit, site)}</aside>`;
  }

  return html`<aside class="panel" aria-label="${site.name}">${head(visit, site, carry, context)}
${linkBlock(site)}${whoBlock(visit, site, carry, ask)}${factsBlock(site)}${versionsBlock(visit, site, context)}${copyingBlock(visit, site)}${moreSettings(visit, site)}${lastBlock(visit, site, carry, ask)}</aside>`;
}
