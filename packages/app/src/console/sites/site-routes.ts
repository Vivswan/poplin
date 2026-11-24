// The data of the Sites screen: one page of the table, one site, one folder of a site's files, and each change of a site.
//
//   GET  /sites                    one page; ?view=trash, ?q=, ?access=, ?sort= with ?dir=, ?after=
//                                  ?q= is a text, or what names one site: its id, its label, its link, or its whole address
//   GET  /sites/<label>            one site, and whether the install lets search engines in
//                                  both with the names of the logins there are, for whoever published a version
//   GET  /sites/<label>/files      one page of one folder of a kept version; ?version=, ?folder=, ?cursor=
//   GET  /public-address?name=     the address a site made public under that name answers at
//   POST /sites/<label>/<change>   naming, access, settings, expiry, delete, restore, delete-for-good, new-link, make-live

import { vValidator } from "@hono/valibot-validator";
import { SITE_CHANGES } from "@poplin/core/src/actions/sites/changes";
import { readConfig } from "@poplin/core/src/actions/install/config";
import { deleteSite } from "@poplin/core/src/actions/sites/delete";
import { listFolder } from "@poplin/core/src/actions/sites/files";
import { listSitesWithNames, MAX_NAMED } from "@poplin/core/src/actions/sites/list";
import { newLink } from "@poplin/core/src/actions/sites/new-link";
import { restoreSite } from "@poplin/core/src/actions/sites/restore";
import { ROLLBACK_OPTIONS, rollbackSite } from "@poplin/core/src/actions/sites/rollback";
import { updateSite } from "@poplin/core/src/actions/sites/set";
import { getSite, getSiteWithNames } from "@poplin/core/src/actions/sites/show";
import { keptPublicNames, readHostLabel } from "@poplin/core/src/names/marker";
import { parsePublicName } from "@poplin/core/src/names/names";
import { mayBeOfInstall, readSiteReference, settleSite } from "@poplin/core/src/sites/references";
import { Hono } from "hono";
import * as v from "valibot";

import { NOTHING, refused, refuseInvalid, type Shared } from "../data";

/** How many sites one page of the table holds. */
const PAGE_SIZE = 25;

/** How many folders and files one page of a folder holds, together. */
const FOLDER_PAGE_SIZE = 200;

/** The place a page of the list ended, as the address carries it: the change time, a dash, the id, and after a tilde the name, the access, or the key of the title of a table ordered by one; that key may be empty. */
const CURSOR_PATTERN = /^([0-9]{1,16})-([0-9a-z]{12})(?:~([\s\S]{0,40}))?$/u;

/** The most characters of a search the route reads: an address with its path and its query fits. */
const MAX_TYPED = 2048;

/** The accesses a table can be narrowed to, from the most private on. */
const ACCESSES = ["private", "unlisted", "public"] as const;

/** What the table's address may ask of the listing. */
const PAGE_QUERY = v.object({
  view: v.optional(v.picklist(["trash"])),
  q: v.optional(v.pipe(v.string(), v.maxLength(MAX_TYPED))),
  access: v.optional(v.picklist(ACCESSES)),
  sort: v.optional(v.picklist(["updated", "name", "access", "title"])),
  dir: v.optional(v.picklist(["asc", "desc"])),
  after: v.optional(v.pipe(v.string(), v.regex(CURSOR_PATTERN))),
});

/** What names one site in a route's path: its label. */
const ONE_SITE = v.object({ site: v.string() });

/** What a page of a folder is asked with: the version's number as the address carries it, the folder's path in the version, and the `next` of the page before. */
const FOLDER_PAGE_QUERY = v.object({
  version: v.pipe(v.string(), v.regex(/^[1-9][0-9]{0,15}$/), v.transform(Number)),
  folder: v.optional(v.string()),
  cursor: v.optional(v.string()),
});

/** What the address of a public name is asked with: the name as it is typed. */
const NAMED = v.object({ name: v.string() });

/** What each change of a site carries. */
const CHANGES = {
  naming: v.pick(SITE_CHANGES, ["name", "title"]),
  access: v.object({ access: v.picklist(ACCESSES), public_name: v.optional(v.string()) }),
  settings: v.pick(SITE_CHANGES, ["search_engines", "embeddable"]),
  expiry: v.required(v.pick(SITE_CHANGES, ["expires"])),
  makeLive: v.required(ROLLBACK_OPTIONS),
};

/** One site of a page. */
type Row = Extract<Awaited<ReturnType<typeof listSitesWithNames>>, { ok: true }>["sites"][number];

/** What the listing is asked. */
type Listing = NonNullable<Parameters<typeof listSitesWithNames>[2]>;

/** The install as it reads an address: its origin, and the layout of its site addresses. */
type Reading = Parameters<typeof settleSite>[1];

/** The public name a typed word is the link of, where a public site's link is its name before the install's public word, as `docs-page` is of `docs`; else the word itself. */
function linkedName(word: string, layout: Reading["layout"]): string {
  if (layout.kind !== "hostname") return word;

  const parts = readHostLabel(word, { publicWord: layout.public_word, reserved: keptPublicNames(layout.public_word) });

  return parts.kind === "public-name" ? parts.name : word;
}

/**
 * What the listing looks for, from what a person typed or pasted: the id or the public name of the site a link or an address of this install names, else the text as it stands.
 * The text is cut to what the listing takes only here, after an address was read whole.
 */
function soughtFor(typed: string, reading: Reading): string {
  const read = readSiteReference(typed);
  const site = read.ok && mayBeOfInstall(read.value, reading.server) ? settleSite(read.value, reading) : undefined;
  if (site !== undefined && site.kind !== "public-name") return site.id;

  if (site?.under !== undefined) return site.name;

  // A text with no address of this install around it may be what the Link column shows of a public site, in any case and of any length.
  return linkedName(site?.name ?? typed.trim().toLowerCase(), reading.layout).slice(0, MAX_NAMED);
}

/** Read the place a page ended from the address: what the listing's own `after` takes under the table's order. A cursor of another order lacks what that order goes by, and the listing refuses it. */
function placeOf(cursor: string | undefined, sort: Listing["sort"]): Pick<Listing, "after"> {
  const [, updated, id, by] = CURSOR_PATTERN.exec(cursor ?? "") ?? [];
  if (updated === undefined || id === undefined) return {};

  const named = sort === "name" && by !== undefined ? { name: by } : {};
  const narrowed = sort === "access" && by !== undefined ? { access: by as (typeof ACCESSES)[number] } : {};
  const titled = sort === "title" && by !== undefined ? { title: by } : {};

  // The id is checked by the listing itself, which refuses one that is none.
  return { after: { updated_at: Number(updated), id, ...named, ...narrowed, ...titled } as Listing["after"] };
}

/** Write the place a page ended as the address carries it. */
function cursorOf(next: NonNullable<Listing["after"]>): string {
  const by = next.name ?? next.access ?? next.title;

  return by === undefined ? `${next.updated_at}-${next.id}` : `${next.updated_at}-${next.id}~${by}`;
}

/** One page of the table as its address asks for it: the sites in the listing's own order, the cursor of the following page or `null`, and the names of the logins that published their versions. */
async function sitesPage(
  { install, actor }: Shared["Variables"]["asker"],
  query: v.InferOutput<typeof PAGE_QUERY>,
  reading: Reading,
): Promise<
  { readonly ok: true; readonly sites: readonly Row[]; readonly next: string | null; readonly logins: Readonly<Record<string, string>> } | Extract<Awaited<ReturnType<typeof listSitesWithNames>>, { ok: false }>
> {
  const named = soughtFor(query.q ?? "", reading);
  const narrowed = { trash: query.view === "trash", ...(named === "" ? {} : { named }), ...(query.access === undefined ? {} : { access: query.access }) };
  const ordered = { ...(query.sort === undefined ? {} : { sort: query.sort }), ...(query.dir === undefined ? {} : { dir: query.dir }) };
  const listed = await listSitesWithNames(install, actor, { ...narrowed, ...ordered, ...placeOf(query.after, query.sort), limit: PAGE_SIZE });
  if (!listed.ok) return listed;

  return { ok: true, sites: listed.sites, next: listed.next === undefined ? null : cursorOf(listed.next), logins: listed.names };
}

/** The Sites screen's data routes. Each change calls one action with the site's label from the address, and answers the site after it. */
export const siteRoutes = new Hono<Shared>()
  .get("/sites", vValidator("query", PAGE_QUERY, refuseInvalid), async (context) => {
    const reading = { server: new URL(context.req.url).origin, layout: context.get("host").layout };
    const page = await sitesPage(context.get("asker"), context.req.valid("query"), reading);

    return page.ok ? context.json(page) : refused(context, page);
  })
  .get("/sites/:site", vValidator("param", ONE_SITE, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const shown = await getSiteWithNames(install, actor, context.req.valid("param").site);
    // An address that names no site in a form a site's label can have is told as a site that is not there: both are an old or mistyped link.
    if (!shown.ok) return refused(context, shown.code === "bad_argument" && shown.about === "site" ? { code: "not_found" } : shown);

    // A site's own switch for search engines does nothing while the install keeps them out, which the panel says at the switch.
    const config = await readConfig(install, actor);
    if (!config.ok) return refused(context, config);

    return context.json({ ok: true as const, site: shown.site, logins: shown.names, search_engines_allowed: config.values.search_engines_allowed });
  })
  .get("/sites/:site/files", vValidator("param", ONE_SITE, refuseInvalid), vValidator("query", FOLDER_PAGE_QUERY, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const listed = await listFolder(install, actor, { site: context.req.valid("param").site, ...context.req.valid("query"), limit: FOLDER_PAGE_SIZE });
    if (!listed.ok) return refused(context, listed);

    return context.json({ ok: true as const, folders: listed.folders, files: listed.files, next: listed.next ?? null, total: listed.total });
  })
  .get("/public-address", vValidator("query", NAMED, refuseInvalid), (context) => {
    const { install } = context.get("asker");
    const named = parsePublicName(context.req.valid("query").name, install.reservedNames);
    if (!named.ok) return refused(context, { code: named.refusal === "reserved" ? "reserved_name" : "bad_name", about: "name" });

    return context.json({ ok: true as const, address: install.publicAddressOf(named.value) });
  })
  .post("/sites/:site/naming", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", CHANGES.naming, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const changed = await updateSite(install, actor, { site: context.req.valid("param").site, ...context.req.valid("json") });

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/access", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", CHANGES.access, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { access, public_name: publicName = "" } = context.req.valid("json");
    // A public name goes with a site made public alone, and an empty one is none.
    const named = access === "public" && publicName !== "" ? { public_name: publicName } : {};
    const changed = await updateSite(install, actor, { site: context.req.valid("param").site, access, ...named });

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/settings", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", CHANGES.settings, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const changed = await updateSite(install, actor, { site: context.req.valid("param").site, ...context.req.valid("json") });

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/expiry", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", CHANGES.expiry, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const changed = await updateSite(install, actor, { site: context.req.valid("param").site, ...context.req.valid("json") });

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/make-live", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", CHANGES.makeLive, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const changed = await rollbackSite(install, actor, { site: context.req.valid("param").site, ...context.req.valid("json") });

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/new-link", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const changed = await newLink(install, actor, context.req.valid("param").site);

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/delete", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const changed = await deleteSite(install, actor, { site: context.req.valid("param").site });

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/restore", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const changed = await restoreSite(install, actor, context.req.valid("param").site);

    return changed.ok ? context.json({ ok: true as const, site: changed.site }) : refused(context, changed);
  })
  .post("/sites/:site/delete-for-good", vValidator("param", ONE_SITE, refuseInvalid), vValidator("json", NOTHING, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const { site } = context.req.valid("param");
    // The console removes for good only what is in the trash: a live site goes there first, where one press brings it back.
    const shown = await getSite(install, actor, site);
    if (!shown.ok) return refused(context, shown);

    if (shown.site.state !== "trash") return refused(context, { code: "not_in_trash" });

    const removed = await deleteSite(install, actor, { site, no_trash: true });

    return removed.ok ? context.json({ ok: true as const, site: removed.site }) : refused(context, removed);
  });
