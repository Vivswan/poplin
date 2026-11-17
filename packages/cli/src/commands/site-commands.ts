// The commands about sites: set, show, list, rollback, new-link, duplicate, delete, and restore. Each is one call to the install, but for duplicate, which calls until the copy is a site, and prints what the install answered.

import type * as v from "valibot";

import { DELETED_SITE } from "../../../core/src/actions/delete";
import { type DUPLICATE_REQUEST, DUPLICATED_SITE } from "../../../core/src/actions/duplicate";
import { LISTED_SITES } from "../../../core/src/actions/list";
import { SITE_ANSWER, type SiteObject } from "../../../core/src/actions/site-object";
import { showBytes } from "../../../core/src/records/settings";
import { showViews } from "../../../core/src/records/views";
import type { Called, Failure } from "../client/client";
import { problem, problemOf } from "./problems";
import type { Outcome, RequestOf, Session } from "./records";
import type { Line } from "../local/screen";
import { addressChange, columns, countText, type DoneRow, dayText, doneRows, GAP, searchNotes, siteLines } from "./text";
import { abandonUpload, callUnhurried, givenUp, giveUpUpload } from "./upload";
import { siteChanges, siteWord } from "./wire";

/** How many sites one page of a listing holds: the most the API gives. */
const PAGE = 100;

/** The most pages `list` asks for: a thousand sites. Past it the listing stops with a note. */
const MAX_PAGES = 10;

/** The status of an answer the install gave. */
const OK = 200;

/** How long the command waits between two asks after a copy the install makes by itself, in milliseconds. */
const WATCH_MS = 2000;

/** How far a site's address stands in under its row of the listing. */
const INDENT = "  ";

/** How some settings are joined into one phrase: `title and expires`. */
const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** The settings of a site a change can leave other than it found them, in the order a change names them. */
const SETTINGS = ["name", "title", "title_typed", "access", "public_name", "expires", "search_engines", "embeddable"] as const;

/** A setting of a site as a change names it, where the words differ from the key the install takes. */
const SETTING_WORDS: Readonly<Record<string, string>> = { search_engines: "search engines", public_name: "public name", title_typed: "title" };

/** What became of a copy that was not finished, in words. */
const AFTERMATH = {
  abandoned: "the copy was given up and no site was made",
  unknown: "the copy could not be given up: it runs out by itself within a day, and poplin list shows whether a site was made",
  live: "the copy was made all the same, and its answer was lost; poplin list shows it",
} as const;

/** The commands this module runs, as the parser read them. */
type SiteRequest = RequestOf<"set" | "show" | "list" | "rollback" | "new-link" | "duplicate" | "delete" | "restore">;

/** One of those commands by its word. */
type Asked<Kind extends SiteRequest["kind"]> = RequestOf<Kind>;

/** A command that takes a site and nothing else. */
type OneSite = Asked<"show" | "new-link" | "restore">;

/** The cursor a page of a listing ends with, which asks for the page after it. */
type Cursor = v.InferOutput<typeof LISTED_SITES>["next"];

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

/** About how often a site's pages were opened, never as an exact number: the counts come from a sample. */
function viewsText(views: SiteObject["views"]): string {
  if (views === null) return "not known";

  return `${showViews(views.today)} times today, ${showViews(views.week)} in the last 7 days`;
}

/**
 * The settings a change left other than it found them, each in the words the site's own listing has for it.
 *
 * @param before - the site as the change found it; `null` where the install did not say
 * @returns the settings as one phrase, or that the site was so already
 */
function changedWords(before: SiteObject | null, site: SiteObject): string {
  if (before === null) return "";

  // A title counts once, whether its words changed or only who gave them: the page, or the person.
  const named = new Set(SETTINGS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(site[key])).map((key) => SETTING_WORDS[key] ?? key));

  return named.size === 0 ? "nothing: it was so already" : LIST.format(named);
}

/**
 * The answer of an action on one site, printed as what was done, who can open the site, and the site's address, with its old address when the action changed it.
 *
 * @param more - the rows the action adds under its first
 */
function answered(called: Called<v.InferOutput<typeof SITE_ANSWER>>, done: string, facts: (site: SiteObject) => readonly string[], notes: readonly string[] = [], more: readonly DoneRow[] = []): Outcome {
  if (!called.ok) return failed(called);

  const { before, site } = called.value;

  return { ok: true, value: called.value, lines: siteLines(done, site, facts(site), [...more, ...addressChange(before, site)]), notes };
}

async function set(request: Asked<"set">, { client }: Session): Promise<Outcome> {
  const changes = siteChanges(request.settings);
  const changed = await client.call(SITE_ANSWER, (api) => api.sites[":site"].$patch({ param: { site: siteWord(request.site) }, json: changes }));
  if (!changed.ok) return failed(changed);

  const { site, before } = changed.value;
  const renamed: DoneRow[] = before === null || before.name === site.name ? [] : [{ tone: "note", done: "renamed", what: `from ${before.name}` }];

  return answered(changed, "changed", () => [changedWords(before, site)], searchNotes(changes, site), renamed);
}

async function show(request: OneSite, { client }: Session): Promise<Outcome> {
  const shown = await client.call(SITE_ANSWER, (api) => api.sites[":site"].$get({ param: { site: siteWord(request.site) } }));
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
    ["pages opened", viewsText(site.views)],
  ];
  const versions = site.versions.map((version) => {
    const live = version.number === site.live_version ? "live" : "";

    return [`version ${version.number}`, dayText(version.published), `by ${version.published_by}`, live];
  });
  const hang = Math.max(...facts.map(([key = ""]) => key.length)) + GAP.length;
  const rows = columns(facts).map((text): Line => ({ tone: "plain", text, hang }));

  return { ok: true, value: shown.value, lines: [site.label, site.url, "", ...rows, "", ...columns(versions)] };
}

/** The listing: one row a site, and under each site that is live its address, alone on a line. */
function listed(sites: readonly SiteObject[], trash: boolean): string[] {
  if (sites.length === 0) return [trash ? "the trash is empty" : "no sites"];

  if (trash) return columns(sites.map((site) => [site.label, site.gone_on === undefined ? "" : `gone for good on ${dayText(site.gone_on)}`, site.title ?? ""]));

  const rows = columns(sites.map((site) => [site.label, site.access, site.title ?? ""]));

  return sites.flatMap((site, at) => [rows[at] ?? "", `${INDENT}${site.url}`]);
}

/** A cursor as the address holds it: one key a part, and no key for a part it lacks. */
function cursorKeys(after: Cursor): { readonly after_updated_at?: string; readonly after_id?: string; readonly after_name?: string; readonly after_access?: string } {
  if (after === undefined) return {};

  const { updated_at, id, name, access } = after;

  return { after_updated_at: String(updated_at), after_id: id, ...(name === undefined ? {} : { after_name: name }), ...(access === undefined ? {} : { after_access: access }) };
}

/** Every page of the listing, up to the cap. */
async function list(request: Asked<"list">, { client }: Session): Promise<Outcome> {
  const sites: SiteObject[] = [];
  let after: Cursor;

  for (let pages = 0; pages < MAX_PAGES && (pages === 0 || after !== undefined); pages += 1) {
    const query = { trash: String(request.trash), limit: String(PAGE), ...cursorKeys(after) };
    const page = await client.call(LISTED_SITES, (api) => api.sites.$get({ query }));
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
  const to = request.to === undefined ? {} : { version: request.to };
  const rolled = await client.call(SITE_ANSWER, (api) => api.sites[":site"].rollback.$post({ param: { site }, json: to }));

  return answered(rolled, "rolled back", (now) => [`version ${now.live_version} is live`]);
}

async function newLink(request: OneSite, { client }: Session): Promise<Outcome> {
  const linked = await client.call(SITE_ANSWER, (api) => api.sites[":site"]["new-link"].$post({ param: { site: siteWord(request.site) } }));
  if (!linked.ok) return failed(linked);

  const { before, site } = linked.value;
  const dead: DoneRow[] = before === null ? [] : [{ tone: "warning", done: "stopped", object: before.label, what: before.addresses.site }];

  return { ok: true, value: linked.value, lines: siteLines("new link", site, [], dead) };
}

function copied(site: SiteObject): (string | Line)[] {
  return siteLines("copied", site, [countText(site.files, "file")]);
}

/**
 * Give up a copy that a call failed in the middle of.
 *
 * @param upload - the upload the copy's last answer named; none when the first call failed, which may have made the copy or begun it all the same
 * @returns the failure with what became of the copy, or the copy as done when the install finished it though its answer was lost; `copy_gone` for a copy the install stopped following
 */
async function stopCopy(session: Session, upload: string | undefined, failure: Failure): Promise<Outcome> {
  if (upload === undefined) return failed({ ok: false, failure });

  const became = await giveUpUpload(session, upload);
  if (became.kind === "published") return { ok: true, value: became.answer, lines: copied(became.answer.site) };

  // A refusal about the upload is no word about the site that was asked for: the install stopped following the copy.
  if (failure.kind === "refused" && failure.code === "not_found" && failure.about === "upload") return { ok: false, problem: problem("copy_gone") };

  return givenUp(failure, AFTERMATH[became.kind]);
}

/** Make one call of a copy, and make it again after each rest the install asks for. The first call names the copy, and each one after it the upload the copy answered. */
function copyOn({ client, io }: Session, site: string, first: v.InferInput<typeof DUPLICATE_REQUEST>, upload: string | undefined): Promise<Called<v.InferOutput<typeof DUPLICATED_SITE>>> {
  const json = upload === undefined ? first : { upload };

  return callUnhurried(io, () => client.call(DUPLICATED_SITE, (api) => api.sites[":site"].duplicate.$post({ param: { site }, json })));
}

/**
 * Say how far a copy that is no site yet is, and wait where the install copies by itself.
 *
 * @param done - how many files the call before this one's had counted
 * @returns nothing when the call is to be made again, or the failure the copy is given up with: the person stopped the command during the wait, or the call copied nothing more
 */
async function beforeNextCall(io: Session["io"], copy: v.InferOutput<typeof DUPLICATED_SITE>["copy"], done: number): Promise<Failure | undefined> {
  if (copy.copied === null) {
    if (io.terminal.progress) io.screen.working(`Copying ${countText(copy.files, "file")} in the background (Ctrl-C stops)`);

    return (await io.pause(WATCH_MS)) === "interrupted" ? { kind: "stopped" } : undefined;
  }

  // A call that copied nothing more would be sent for ever.
  if (copy.copied <= done) return { kind: "unexpected", status: OK };

  if (io.terminal.progress) io.screen.working(`Copying ${copy.copied} of ${countText(copy.files, "file")}`);

  return undefined;
}

/**
 * Copy a site: the call is sent again with the upload it answered until it answers the new site. A copy that cannot be finished, or that the person stops, is given up, as a publish is.
 *
 * An install that copies by itself answers no count of files: the command then waits between two calls. Any other install copies a few files with each call.
 */
async function duplicate(request: Asked<"duplicate">, session: Session): Promise<Outcome> {
  const { client, io } = session;
  const site = siteWord(request.site);
  const first = request.name === undefined ? {} : { name: request.name };
  let upload: string | undefined;

  try {
    for (let done = -1; ; ) {
      const called = await copyOn(session, site, first, upload);
      if (!called.ok) return await stopCopy(session, upload, called.failure);

      const { copy } = called.value;
      if (called.value.site !== null) return { ok: true, value: called.value, lines: copied(called.value.site) };

      upload = copy.upload;
      const failure = await beforeNextCall(io, copy, done);
      if (failure !== undefined) return await stopCopy(session, upload, failure);

      done = copy.copied ?? done;
    }
  } catch (error) {
    if (upload !== undefined) await abandonUpload(client, upload);

    throw error;
  } finally {
    if (io.terminal.progress) io.screen.rest();
  }
}

/**
 * Remove a site for good, and say what is gone: the one act nothing undoes names the site, what it held, and each address that stopped working.
 *
 * @param site - the word the install takes for the site
 * @returns the install's answer with those lines, or why nothing was removed. Whoever calls it has the person's word first: the command the typed label, a tool its own argument
 */
export async function removeForGood(site: string, { client }: Pick<Session, "client">): Promise<Outcome> {
  const deleted = await client.call(DELETED_SITE, (api) => api.sites[":site"].$delete({ param: { site }, query: { no_trash: "true" } }));
  if (!deleted.ok) return failed(deleted);

  const { before, left } = deleted.value;
  const notes = left.length === 0 ? [] : ["the site is gone, and some of its files are still being removed"];
  if (before === null) return { ok: true, value: deleted.value, lines: [{ tone: "done", text: "deleted for good; nothing can restore it" }], notes };

  const addresses = [before.addresses.site];
  if (before.addresses.public !== null) addresses.push(before.addresses.public);

  const lost = `${countText(before.files, "file")} in ${countText(before.versions.length, "kept version")}`;

  return { ok: true, value: deleted.value, lines: [{ tone: "done", text: `deleted for good  ${before.label}` }, `gone: ${lost}; nothing can restore them`, `stopped working: ${addresses.join(" and ")}`], notes };
}

/** Remove a site for good, once its label is typed on a terminal. Without a terminal to ask on, and at a question the person stopped, nothing is removed. */
async function deleteForever(request: Asked<"delete">, session: Session): Promise<Outcome> {
  const { client, io } = session;
  if (!io.terminal.asks) return { ok: false, problem: problem("no_terminal") };

  const found = await client.call(SITE_ANSWER, (api) => api.sites[":site"].$get({ param: { site: siteWord(request.site) } }));
  if (!found.ok) return failed(found, "reads");

  const { label } = found.value.site;
  io.screen.aside("warning", `This removes ${label} and every file of it for good.`);
  const typed = await io.screen.ask(`Type ${label} to go on:`);
  if (typed === undefined) return { ok: false, problem: problem("stopped", "nothing was deleted") };

  if (typed.trim() !== label) return { ok: false, problem: problem("not_confirmed") };

  return removeForGood(label, session);
}

async function deleteSite(request: Asked<"delete">, session: Session): Promise<Outcome> {
  if (request.noTrash) return deleteForever(request, session);

  const trashed = await session.client.call(DELETED_SITE, (api) => api.sites[":site"].$delete({ param: { site: siteWord(request.site) } }));
  if (!trashed.ok) return failed(trashed);

  const { site } = trashed.value;
  if (site === null) return { ok: true, value: trashed.value, lines: [] };

  const gone = site.gone_on === undefined ? [] : [`gone for good on ${dayText(site.gone_on)}`];

  return { ok: true, value: trashed.value, lines: doneRows([{ tone: "done", done: "in the trash", object: site.label, what: gone.join(GAP) }]), steps: [`to take it back: poplin restore ${site.label}`] };
}

async function restore(request: OneSite, { client }: Session): Promise<Outcome> {
  const restored = await client.call(SITE_ANSWER, (api) => api.sites[":site"].restore.$post({ param: { site: siteWord(request.site) } }));

  return answered(restored, "restored", () => []);
}

/**
 * Run one command about sites against the install.
 *
 * @returns what the install answered, worded for a person and kept whole for `--json`, or the problem. `delete --no-trash` asks for the site's label first, and removes nothing unless it is typed
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
    case "duplicate":
      return duplicate(request, session);
    case "delete":
      return deleteSite(request, session);
    case "restore":
      return restore(request, session);
  }
}
