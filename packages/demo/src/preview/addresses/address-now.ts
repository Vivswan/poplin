// An address from before the sample data was made anew: every seed gives each site a new id, so the address names an id no site has.
//
//   /sites/sales-report--<the id it had>                    leads to   /sites/sales-report--<the id it has now>
//   /served/sales-report--<the id it had>-p-poplin/q3.html  leads to   /served/sales-report--<the id it has now>-p-poplin/q3.html
//
// A served address leads on only to a private site, which the login stands in front of. The id in the link of an unlisted or a public site is what lets a stranger in:
// an address with another id, the link from before "New link" or a guessed one, leads nowhere, as in the product.

import { listSites } from "../../../../core/src/actions/sites/list";
import type { SiteName } from "../../../../core/src/names/names";
import type { SiteId } from "../../../../core/src/sites/ids";
import { splitLabel } from "../../../../core/src/sites/labels";
import { localAddress, type Mount } from "./mount";
import type { World } from "../world/world";

/** What the address of a site's panel starts with, in the dashboard. */
const PANEL_PREFIX = "/sites/";

/** A site as an address names it, and how the address of the site that holds the name now is written. */
interface Named {
  readonly name: SiteName;
  readonly id: SiteId;
  readonly write: (site: Listed) => string | undefined;
}

/** One site of a listing. */
type Listed = Extract<Awaited<ReturnType<typeof listSites>>, { readonly ok: true }>["sites"][number];

/** The sites outside the trash that hold a name, read page by page: the listing keeps every site whose name, title, or public name holds the text. */
async function sitesNamed(world: World, name: string): Promise<readonly Listed[]> {
  const sites: Listed[] = [];
  let after: Parameters<typeof listSites>[2] = {};

  while (after !== undefined) {
    const page = await listSites(world.install, world.admin, { ...after, named: name });
    if (!page.ok) return [];

    sites.push(...page.sites.filter((site) => site.name === name));
    after = page.next === undefined ? undefined : { after: page.next };
  }

  return sites;
}

/** The site a panel's address names. */
function panelSite(world: World, path: string): Named | undefined {
  const parts = splitLabel(decodeURIComponent(path.slice(PANEL_PREFIX.length)), world.install.reservedNames);
  if (!parts.ok || parts.value.kind !== "site") return undefined;

  return { name: parts.value.name, id: parts.value.id, write: (site) => `${PANEL_PREFIX}${site.label}` };
}

/** The site a served address names with its id and a name. A private site that holds the name now is served at its own address, at the same file; a site a link alone opens is not led to. */
function servedSite(world: World, asked: URL, here: Pick<Mount, "prefix" | "origin">): Named | undefined {
  const at = URL.parse(`${here.origin}${asked.pathname.slice(here.prefix.length)}`);
  const parts = at === null ? undefined : world.kind.addresses.resolve(at);
  if (parts?.kind !== "site" || parts.name === undefined) return undefined;

  const root = (site: Listed): string => localAddress(site.url, { here: { ...here, base: "" }, kind: world.kind }).replace(/\/$/, "");

  return { name: parts.name, id: parts.id, write: (site) => (site.access === "private" ? `${root(site)}${parts.path}` : undefined) };
}

/** The site an address names with its id; none for an address of any other place. */
function namedBy(world: World, asked: URL): Named | undefined {
  const here = world.kind.siteAt(asked);
  if (here !== undefined) return servedSite(world, asked, here);

  return asked.pathname.startsWith(PANEL_PREFIX) ? panelSite(world, asked.pathname) : undefined;
}

/**
 * Find where an address leads now whose site has an id no site has: a site's panel in the dashboard, or a site as the preview serves it.
 *
 * @param asked - the address the preview was asked at
 * @returns the same place at the one site that holds the name now, as an address of the preview; `undefined` for any other address, for an id a site has, in the trash or under another name too,
 *   for a name that none or several hold, and for a served address of a site that is not private
 */
export async function addressNow(world: World, asked: URL): Promise<string | undefined> {
  const named = namedBy(world, asked);
  if (named === undefined || (await world.install.database.getSite(named.id)) !== undefined) return undefined;

  const [only, ...others] = await sitesNamed(world, named.name);

  return only === undefined || others.length > 0 ? undefined : named.write(only);
}
