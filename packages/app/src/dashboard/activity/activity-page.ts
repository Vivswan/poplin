// The Activity tab: the audit log, the newest entry first.

import { listAudit } from "@poplin/core/src/actions/audit-log";
import type { AuditAction } from "@poplin/core/src/records/audit";
import { siteLabel } from "@poplin/core/src/sites/labels";
import { html } from "hono/html";

import { showMoment } from "../page/amounts";
import { refusedPage } from "../page/frame";
import type { Html, Page, Visit } from "../records";

/** How many entries one page of the log holds. */
const PAGE_SIZE = 50;

/** The place a page ended, as the address carries it: the `seq` of its last entry. */
const SEQ_PATTERN = /^[1-9][0-9]{0,15}$/;

/** What each action of the log is called. A key missing here does not compile. */
const WORDS: Readonly<Record<Exclude<AuditAction, "domain_synced">, string>> = {
  create: "made the site",
  publish: "published a version",
  live_version: "rolled back",
  access: "changed the access",
  details: "changed the settings",
  new_id: "made a new link",
  trash: "moved to the trash",
  restore: "restored from the trash",
  delete: "deleted forever",
  imported: "imported the site",
  duplicate: "made the site as a copy",
  token_added: "added a token",
  token_revoked: "revoked a token",
  settings_set: "set the first settings",
  settings_changed: "changed the settings of the install",
  "signed_everyone_out": "signed everyone out",
  login: "logged in",
  login_allowed: "allowed a computer to log in",
  login_denied: "denied a computer's login",
};

/** One entry of the log. */
type Entry = Extract<Awaited<ReturnType<typeof listAudit>>, { ok: true }>["entries"][number];

/** The sites of a page that still exist, by the id the log names: the label each has now. */
type Labels = ReadonlyMap<string, string>;

function beforeIn(url: URL): unknown {
  const before = url.searchParams.get("before");
  if (before === null) return undefined;

  return SEQ_PATTERN.test(before) ? Number(before) : before;
}

/** The label of every site the entries name that is still a site, read in one query however many sites a page names. */
async function labelsOf(visit: Visit, entries: readonly Entry[]): Promise<Labels> {
  const ids = new Set(entries.flatMap((entry) => (entry.site === null ? [] : [entry.site.id])));
  const names = await visit.install.database.getSiteNames([...ids]);

  return new Map(Array.from(names, ([id, name]) => [id, siteLabel(name, id)]));
}

function siteCell(entry: Entry, labels: Labels): Html {
  if (entry.site === null) return html``;

  const label = labels.get(entry.site.id);
  if (label === undefined) return html`${entry.site.name}`;

  return html`<a href="/sites/${encodeURIComponent(label)}">${entry.site.name}</a>`;
}

// A run on the domain says which it was, and a repair that stopped names the row it stopped at.
function domainWords(detail: Entry["detail"]): string {
  if (detail.run !== "repair") return "checked the domain";

  const [failed] = Array.isArray(detail.failed) ? detail.failed : [];
  if (typeof failed !== "string") return "repaired the domain";

  return `repair stopped at ${failed.split(": ")[0]}`;
}

function wordsOf(entry: Entry): string {
  return entry.action === "domain_synced" ? domainWords(entry.detail) : WORDS[entry.action];
}

function entryRow(entry: Entry, labels: Labels): Html {
  return html`<tr><td>${showMoment(entry.at)}</td><td>${entry.by}</td><td>${wordsOf(entry)}</td><td>${siteCell(entry, labels)}</td></tr>`;
}

function paging(onFirst: boolean, entries: readonly Entry[]): Html {
  const last = entries.at(-1);
  const first = onFirst ? html`` : html`<a href="/activity">Newest</a> `;
  const older = entries.length < PAGE_SIZE || last === undefined ? html`` : html`<a href="/activity?before=${last.seq}">Older</a>`;

  return html`<p>${first}${older}</p>`;
}

/**
 * Show one page of the audit log.
 *
 * @returns when, who, what, and which site, the newest first; a site that still exists is a link to its page. `before` in the address is the `seq` the page before ended on
 */
export async function showActivity(visit: Visit): Promise<Page> {
  const place = { tab: "activity", heading: "Activity" } as const;
  const before = beforeIn(visit.url);

  // The action checks the place, so anything the address holds is handed over as it is.
  const listed = await listAudit(visit.install, visit.actor, { limit: PAGE_SIZE, before } as Parameters<typeof listAudit>[2]);
  if (!listed.ok) return refusedPage(place, listed);

  const labels = await labelsOf(visit, listed.entries);
  const body = html`<div class="scroll" role="region" aria-label="Activity" tabindex="0"><table>
<thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Site</th></tr></thead>
<tbody>${listed.entries.map((entry) => entryRow(entry, labels))}</tbody>
</table></div>
${paging(before === undefined, listed.entries)}`;

  return { ...place, body };
}
