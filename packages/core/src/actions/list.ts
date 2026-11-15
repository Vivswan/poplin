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

/** The most characters a listing matches names against: no site name is longer. */
const MAX_NAMED = 40;

/** An access a site has. */
const ACCESS = v.picklist(["private", "unlisted", "public"]);

/** What a listing may ask for. */
export const LIST_QUERY = v.strictObject({
  trash: v.optional(v.boolean(), false),
  limit: v.optional(v.pipe(POSITIVE, v.maxValue(MAX_PAGE)), MAX_PAGE),
  after: v.optional(v.strictObject({ updated_at: MOMENT, id: SITE_ID, name: v.optional(v.pipe(v.string(), v.maxLength(MAX_NAMED))), access: v.optional(ACCESS) })),
  named: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_NAMED))),
  access: v.optional(ACCESS),
  expires: v.optional(v.picklist(["set", "never"])),
  sort: v.optional(v.picklist(["updated", "name", "access"])),
  dir: v.optional(v.picklist(["asc", "desc"])),
});

/** What a listing answers: one page of sites, and what `after` takes to get the following page. */
export const LISTED_SITES = v.object({ sites: v.pipe(v.array(SITE_OBJECT), v.readonly()), next: LIST_QUERY.entries.after });

/** One page of sites, the one whose content changed last first: a publish and a version made live count, a setting does not. The trash shows the site deleted last first. `next` is what `after` takes to get the following page, and is absent on the last. */
type Listed = { readonly ok: true } & Readonly<v.InferOutput<typeof LISTED_SITES>>;

/**
 * List the sites an actor may see, each with about how often its pages were opened: every site for an admin, its own for a publisher.
 *
 * @param query - `trash` lists the trash instead; `limit` is 1 to 100; `after` is the `next` of the page before, asked under the same `sort`.
 *   `named` keeps the sites whose name holds that text, `access` those of that access, and `expires` those that delete themselves on a set day (`set`) or never do (`never`).
 *   `sort` orders by the last change (`updated`, the newest first), by `name`, or by `access` from private to public, and `dir` turns the order around
 * @returns the page, or `bad_argument` naming the key that was refused: `after` for a cursor that does not carry what its `sort` goes by
 */
export async function listSites(install: Install, actor: Actor, query: v.InferInput<typeof LIST_QUERY> = {}): Promise<Listed | Refused<"not_set_up" | "bad_argument">> {
  const entered = await enterInstall(install, actor);
  if (!entered.ok) return entered;

  const asked = v.safeParse(LIST_QUERY, query);
  if (!asked.success) return refuse("bad_argument", v.getDotPath(asked.issues[0])?.split(".")[0] ?? "query");

  const { after, sort } = asked.output;
  if (after !== undefined && ((sort === "name" && after.name === undefined) || (sort === "access" && after.access === undefined))) return refuse("bad_argument", "after");

  const owner = actor.scope === "admin" ? undefined : actor.holder;
  const page = await install.database.listSites({ ...asked.output, owner });
  const views = await install.database.readViews(
    page.sites.map((site) => site.id),
    dayOf(entered.signed.at),
  );
  const sites = page.sites.map((site) => siteObject(site, install, entered.settings.trash_days, views.get(site.id) ?? null));
  if (page.next === undefined) return { ok: true, sites };

  return { ok: true, sites, next: page.next };
}
