// The commands about sites: set, show, list, rollback, new-link, delete, and restore. Each is one call to the install, and prints what the install answered.

import type { ROUTES } from "../../../core/src/api/routes";
import { showBytes } from "../../../core/src/records/settings";
import type { Called } from "../client/client";
import { problem, problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";
import { columns, countText, dayText, type SiteObject, searchNotes, siteLines } from "./text";
import { siteChanges, siteWord } from "./wire";

/** How many sites one page of a listing holds: the most the API gives. */
const PAGE = 100;

/** The most pages `list` asks for: a thousand sites. Past it the listing stops with a note. */
const MAX_PAGES = 10;

/** The commands this module runs, as the parser read them. */
type SiteRequest = RequestOf<"set" | "show" | "list" | "rollback" | "new-link" | "delete" | "restore">;

/** One of those commands by its word. */
type Asked<Kind extends SiteRequest["kind"]> = RequestOf<Kind>;

/** A command that takes a site and nothing else. */
type OneSite = Asked<"show" | "new-link" | "restore">;

/** The cursor a page of a listing ends with, which asks for the page after it. */
type Cursor = NonNullable<(typeof ROUTES)["listSites"]["types"]>["done"]["next"];

/** The problem of a call that failed. A call that changes a site says so, since a change whose answer was lost may have been made. */
function failed(called: { readonly ok: false; readonly failure: Parameters<typeof problemOf>[0] }, call: "reads" | "changes" = "changes"): Outcome {
  return { ok: false, problem: problemOf(called.failure, call) };
}

function switchText(on: boolean): string {
  return on ? "on" : "off";
}

function expiryText(expires: SiteObject["expires"]): string {
  return expires === "never" ? "never" : dayText(expires);
}

function accessFacts(site: SiteObject): string[] {
  return site.public_name === null ? [] : [`public name ${JSON.stringify(site.public_name)}`];
}

/** The answer of an action on one site, printed as what was done and the site's address. */
function answered(called: Called<{ readonly site: SiteObject }>, done: string, facts: (site: SiteObject) => readonly string[], notes: readonly string[] = []): Outcome {
  if (!called.ok) return failed(called);

  return { ok: true, value: called.value, lines: siteLines(done, called.value.site, facts(called.value.site)), notes };
}

async function set(request: Asked<"set">, { client }: Session): Promise<Outcome> {
  const changes = siteChanges(request.settings);
  const changed = await client.call("updateSite", { site: siteWord(request.site) }, changes);
  if (!changed.ok) return failed(changed);

  const { site } = changed.value;

  return answered(changed, site.access, accessFacts, searchNotes(changes, site));
}

async function show(request: OneSite, { client }: Session): Promise<Outcome> {
  const shown = await client.call("getSite", { site: siteWord(request.site) });
  if (!shown.ok) return failed(shown, "reads");

  const { site } = shown.value;
  const state = site.gone_on === undefined ? site.state : `in the trash, gone for good on ${dayText(site.gone_on)}`;
  const facts = [
    ["id", site.id],
    ["name", site.name],
    ["public name", site.public_name ?? "none"],
    ["title", site.title ?? "none"],
    ["access", site.access],
    ["state", state],
    ["search engines", switchText(site.search_engines)],
    ["embeddable", switchText(site.embeddable)],
    ["expires", expiryText(site.expires)],
    ["kept", `${showBytes(site.bytes)} in ${countText(site.files, "file")}, every kept version counted`],
  ];
  const versions = site.versions.map((version) => {
    const live = version.number === site.live_version ? "live" : "";

    return [`version ${version.number}`, dayText(version.published), `by ${version.published_by}`, live];
  });

  return { ok: true, value: shown.value, lines: [site.label, site.url, ...columns(facts), ...columns(versions)] };
}

function listed(sites: readonly SiteObject[], trash: boolean): string[] {
  if (sites.length === 0) return [trash ? "the trash is empty" : "no sites"];

  if (trash) return columns(sites.map((site) => [site.label, site.gone_on === undefined ? "" : `gone for good on ${dayText(site.gone_on)}`, site.title ?? ""]));

  return columns(sites.map((site) => [site.label, site.access, site.url, site.title ?? ""]));
}

/** Every page of the listing, up to the cap. */
async function list(request: Asked<"list">, { client }: Session): Promise<Outcome> {
  const sites: SiteObject[] = [];
  let after: Cursor;

  for (let pages = 0; pages < MAX_PAGES && (pages === 0 || after !== undefined); pages += 1) {
    const page = await client.call("listSites", after === undefined ? { trash: request.trash, limit: PAGE } : { trash: request.trash, limit: PAGE, after });
    if (!page.ok) return failed(page, "reads");

    sites.push(...page.value.sites);
    after = page.value.next;
  }

  const lines = listed(sites, request.trash);
  if (after === undefined) return { ok: true, value: { sites }, lines };

  return { ok: true, value: { sites, next: after }, lines, notes: [`the first ${sites.length} sites are shown, and the install holds more`] };
}

async function rollback(request: Asked<"rollback">, { client }: Session): Promise<Outcome> {
  const site = siteWord(request.site);
  const rolled = await client.call("rollbackSite", { site }, request.to === undefined ? {} : { version: request.to });

  return answered(rolled, "rolled back", (now) => [`version ${now.live_version} is live`]);
}

async function newLink(request: OneSite, { client }: Session): Promise<Outcome> {
  const linked = await client.call("newLink", { site: siteWord(request.site) });
  if (!linked.ok) return failed(linked);

  const { before, site } = linked.value;
  const dead = before === null ? [] : [`the old label ${before.label} and its address ${before.addresses.site} stopped working`];

  return { ok: true, value: linked.value, lines: [...siteLines("new link", site, []), ...dead] };
}

/** Remove a site for good, once its label is typed on a terminal. Without a terminal to ask on, nothing is removed. */
async function deleteForever(request: Asked<"delete">, { client, io }: Session): Promise<Outcome> {
  if (!io.terminal.asks) return { ok: false, problem: problem("no_terminal") };

  const found = await client.call("getSite", { site: siteWord(request.site) });
  if (!found.ok) return failed(found, "reads");

  const { label } = found.value.site;
  const typed = await io.ask(`This removes ${label} and every file of it for good. Type its label to go on: `);
  if (typed.trim() !== label) return { ok: false, problem: problem("not_confirmed") };

  const deleted = await client.call("deleteSite", { site: label, forever: true });
  if (!deleted.ok) return failed(deleted);

  const notes = deleted.value.left.length === 0 ? [] : ["the site is gone, and some of its files are still being removed"];

  return { ok: true, value: deleted.value, lines: [], notes };
}

async function deleteSite(request: Asked<"delete">, session: Session): Promise<Outcome> {
  if (request.forever) return deleteForever(request, session);

  const trashed = await session.client.call("deleteSite", { site: siteWord(request.site) });
  if (!trashed.ok) return failed(trashed);

  const { site } = trashed.value;
  if (site === null) return { ok: true, value: trashed.value, lines: [] };

  const gone = site.gone_on === undefined ? [] : [`gone for good on ${dayText(site.gone_on)}`];

  return { ok: true, value: trashed.value, lines: [["in the trash", site.label, ...gone].join("  "), `to take it back: poplin restore ${site.label}`] };
}

async function restore(request: OneSite, { client }: Session): Promise<Outcome> {
  const restored = await client.call("restoreSite", { site: siteWord(request.site) });

  return answered(restored, "restored", (site) => [site.access, ...accessFacts(site)]);
}

/**
 * Run one command about sites against the install.
 *
 * @returns what the install answered, worded for a person and kept whole for `--json`, or the problem. `delete --forever` asks for the site's label first, and removes nothing unless it is typed
 */
export async function runSiteCommand(request: SiteRequest, session: Session): Promise<Outcome> {
  switch (request.kind) {
    case "set":
      return set(request, session);
    case "show":
      return show(request, session);
    case "list":
      return list(request, session);
    case "rollback":
      return rollback(request, session);
    case "new-link":
      return newLink(request, session);
    case "delete":
      return deleteSite(request, session);
    case "restore":
      return restore(request, session);
  }
}
