// List: one page of the sites, or of the trash.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import { MOMENT, POSITIVE, SITE_ID } from "../records/fields";
import { dayOf } from "../records/views";
import { enterInstall } from "./reach";
import { type Install, type Refused, refuse } from "./records";
import { SITE_OBJECT, siteObject } from "./site-object";

/** The most sites one page holds, and how many a page holds when no limit is asked. */
const MAX_PAGE = 100;

/** The most characters a listing looks for in a name or a title, and a cursor carries as a name or as the key of a title: no site name is longer, and a listing by title goes by no more. */
export const MAX_NAMED = 40;

/** An access a site has. */
const ACCESS = v.picklist(["private", "unlisted", "public"]);

/** What a listing may ask for. */
export const LIST_QUERY = v.strictObject({
  trash: v.optional(v.boolean(), false),
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_PAGE)), MAX_PAGE),
  after: v.optional(v.strictObject({ updated_at: MOMENT, id: SITE_ID, name: v.optional(v.pipe(v.string(), v.maxLength(MAX_NAMED))), access: v.optional(ACCESS), title: v.optional(v.pipe(v.string(), v.maxCodePoints(MAX_NAMED))) })),
  named: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_NAMED))),
  access: v.optional(ACCESS),
  expires: v.optional(v.picklist(["set", "never"])),
  sort: v.optional(v.picklist(["updated", "name", "access", "title"])),
  dir: v.optional(v.picklist(["asc", "desc"])),
});

/** What a listing answers: one page of sites, and what `after` takes to get the following page. */
export const LISTED_SITES = v.object({ sites: v.pipe(v.array(SITE_OBJECT), v.readonly()), next: LIST_QUERY.entries.after });

/** One page of sites, the one whose content changed last first: a publish and a version made live count, a setting does not. The trash shows the site deleted last first. `next` is what `after` takes to get the following page, and is absent on the last. */
type Listed = { readonly ok: true } & Readonly<v.InferOutput<typeof LISTED_SITES>>;

/** One page of sites, and the note of each token that published a kept version of one of them, by the token's id. */
type ListedWithNames = Listed & { readonly names: Readonly<Record<string, string>> };

/** Why a listing's query is refused, or the query as checked. */
function checkedQuery(query: v.InferInput<typeof LIST_QUERY>): v.InferOutput<typeof LIST_QUERY> | Refused<"bad_argument"> {
  const asked = v.safeParse(LIST_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "query");

  const { after, sort } = asked.output;
  if (after !== undefined && sort !== undefined && sort !== "updated" && after[sort] === undefined) return refuse("bad_argument", "after");

  return asked.output;
}

/** Read one page with the settings, the views, and the publishers' notes when asked for, as one question to the database. */
async function readPage(install: Install, actor: Actor, query: v.InferInput<typeof LIST_QUERY>, publishers: boolean): Promise<ListedWithNames | Refused<"not_set_up" | "bad_argument">> {
  const asked = checkedQuery(query);
  if ("ok" in asked) {
    const entered = await enterInstall(install, actor);

    return entered.ok ? asked : entered;
  }

  const at = install.now();
  const owner = actor.scope === "admin" ? undefined : actor.holder;
  const page = await install.database.listShownSites({ ...asked, owner }, { day: dayOf(at), publishers });
  const settings = install.knownSettings ?? page.settings;
  if (settings === undefined) return refuse("not_set_up");

  const sites = page.sites.map((site) => siteObject(site, install, settings.trash_days, page.views.get(site.id) ?? null));
  const names = Object.fromEntries(page.publishers);
  if (page.next === undefined) return { ok: true, sites, names };

  return { ok: true, sites, next: page.next, names };
}

/**
 * List the sites an actor may see, each with about how often its pages were opened: every site for an admin, its own for a publisher.
 *
 * @param query - `trash` lists the trash instead; `limit` is 1 to 100; `after` is the `next` of the page before, asked under the same `sort`.
 *   `named` keeps the sites whose name, title, or public name holds that text, the letters A to Z in either case and no sign read as a pattern, and the site whose id is that text; the title is the one a site is listed with.
 *   `access` keeps those of that access, and `expires` those that delete themselves on a set day (`set`) or never do (`never`).
 *   `sort` orders by the last change (`updated`, the newest first), by `name`, by `access` from private to public,
 *   or by `title`: what a site is listed with, its title or else its name, by the first 40 characters and with A to Z in either case alike. `dir` turns the order around
 * @returns the page, or `bad_argument` naming the key that was refused: `after` for a cursor that does not carry what its `sort` goes by
 */
export async function listSites(install: Install, actor: Actor, query: v.InferInput<typeof LIST_QUERY> = {}): Promise<Listed | Refused<"not_set_up" | "bad_argument">> {
  const read = await readPage(install, actor, query, false);
  if (!read.ok) return read;

  const { names: unasked, ...listed } = read;

  return listed;
}

/**
 * List the sites as `listSites` does and, for an admin, name whoever published their kept versions: what a screen writes where a token published something.
 *
 * @returns the page, with `names` holding the note of each such token that has one, by the token's id, removed or not; no name for anyone but an admin
 */
export async function listSitesWithNames(install: Install, actor: Actor, query: v.InferInput<typeof LIST_QUERY> = {}): Promise<ListedWithNames | Refused<"not_set_up" | "bad_argument">> {
  return readPage(install, actor, query, actor.scope === "admin");
}
