// The data of the Sites screen: one page of the table, one site, and each change of a site.
//
//   GET  /sites                    one page; ?view=trash, ?q=, ?access=, ?sort= with ?dir=, ?after=
//   GET  /sites/<label>            one site
//                                  both with the names of the logins there are, for whoever published a version
//   POST /sites/<label>/<change>   naming, access, settings, delete, restore, new-link, make-live

import { vValidator } from "@hono/valibot-validator";
import { SITE_CHANGES } from "@poplin/core/src/actions/changes";
import { deleteSite } from "@poplin/core/src/actions/delete";
import { listSites } from "@poplin/core/src/actions/list";
import { newLink } from "@poplin/core/src/actions/new-link";
import { restoreSite } from "@poplin/core/src/actions/restore";
import { ROLLBACK_OPTIONS, rollbackSite } from "@poplin/core/src/actions/rollback";
import { updateSite } from "@poplin/core/src/actions/set";
import { getSite } from "@poplin/core/src/actions/show";
import { Hono } from "hono";
import * as v from "valibot";

import { loginNames, NOTHING, refused, refuseInvalid, type Shared } from "./data";

/** How many sites one page of the table holds. */
const PAGE_SIZE = 25;

/** The place a page of the list ended, as the address carries it: the change time, a dash, the id, and after a tilde the name, the access, or the key of the title of a table ordered by one; that key may be empty. */
const CURSOR_PATTERN = /^([0-9]{1,16})-([0-9a-z]{12})(?:~([\s\S]{0,40}))?$/u;

/** The accesses a table can be narrowed to, from the most private on. */
const ACCESSES = ["private", "unlisted", "public"] as const;

/** What the table's address may ask of the listing. */
const PAGE_QUERY = v.object({
  view: v.optional(v.picklist(["trash"])),
  q: v.optional(v.string()),
  access: v.optional(v.picklist(ACCESSES)),
  sort: v.optional(v.picklist(["updated", "name", "access", "title"])),
  dir: v.optional(v.picklist(["asc", "desc"])),
  after: v.optional(v.pipe(v.string(), v.regex(CURSOR_PATTERN))),
});

/** What names one site in a route's path: its label. */
const ONE_SITE = v.object({ site: v.string() });

/** What each change of a site carries. */
const CHANGES = {
  naming: v.pick(SITE_CHANGES, ["name", "title"]),
  access: v.object({ access: v.picklist(ACCESSES), public_name: v.optional(v.string()) }),
  settings: v.pick(SITE_CHANGES, ["search_engines", "embeddable"]),
  makeLive: v.required(ROLLBACK_OPTIONS),
};

/** One site of a page. */
type Row = Extract<Awaited<ReturnType<typeof listSites>>, { ok: true }>["sites"][number];

/** What the listing is asked. */
type Listing = NonNullable<Parameters<typeof listSites>[2]>;

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

/** One page of the table as its address asks for it: the sites in the listing's own order, and the cursor of the following page or `null`. */
async function sitesPage(
  { install, actor }: Shared["Variables"]["asker"],
  query: v.InferOutput<typeof PAGE_QUERY>,
): Promise<
  { readonly ok: true; readonly sites: readonly Row[]; readonly next: string | null } | Extract<Awaited<ReturnType<typeof listSites>>, { ok: false }>
> {
  const named = (query.q ?? "").trim().toLowerCase();
  const narrowed = { trash: query.view === "trash", ...(named === "" ? {} : { named }), ...(query.access === undefined ? {} : { access: query.access }) };
  const ordered = { ...(query.sort === undefined ? {} : { sort: query.sort }), ...(query.dir === undefined ? {} : { dir: query.dir }) };
  const listed = await listSites(install, actor, { ...narrowed, ...ordered, ...placeOf(query.after, query.sort), limit: PAGE_SIZE });
  if (!listed.ok) return listed;

  return { ok: true, sites: listed.sites, next: listed.next === undefined ? null : cursorOf(listed.next) };
}

/** The Sites screen's data routes. Each change calls one action with the site's label from the address, and answers the site after it. */
export const siteRoutes = new Hono<Shared>()
  .get("/sites", vValidator("query", PAGE_QUERY, refuseInvalid), async (context) => {
    const page = await sitesPage(context.get("asker"), context.req.valid("query"));
    if (!page.ok) return refused(context, page);

    return context.json({ ...page, logins: await loginNames(context.get("asker")) });
  })
  .get("/sites/:site", vValidator("param", ONE_SITE, refuseInvalid), async (context) => {
    const { install, actor } = context.get("asker");
    const shown = await getSite(install, actor, context.req.valid("param").site);
    // An address that names no site in a form a site's label can have is told as a site that is not there: both are an old or mistyped link.
    if (!shown.ok) return refused(context, shown.code === "bad_argument" && shown.about === "site" ? { code: "not_found" } : shown);

    return context.json({ ok: true as const, site: shown.site, logins: await loginNames(context.get("asker")) });
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
  });
