// An address from before the sample data was made anew: every seed gives each site a new id, so the address names an id no site has.
//
//   /sites/sales-report--<the id it had>                    leads to   /sites/sales-report--<the id it has now>
//   /served/sales-report--<the id it had>-p-poplin/q3.html  leads to   /served/sales-report--<the id it has now>-p-poplin/q3.html

import { listSites } from "../../../core/src/actions/list";
import type { SiteName } from "../../../core/src/names/names";
import type { SiteId } from "../../../core/src/sites/ids";
import { splitLabel } from "../../../core/src/sites/labels";
import { SERVED_PREFIX, servedPath, siteOrigin } from "./mount";
import { ADDRESSES, type World } from "./world";

/** What the address of a site's panel starts with, in the dashboard. */
const PANEL_PREFIX = "/sites/";

/** What the address of a served site starts with. */
const SERVED_START = `${SERVED_PREFIX}/`;

/** A site as an address names it, and how the address of the site that holds the name now is written. */
interface Named {
  readonly name: SiteName;
  readonly id: SiteId;
  readonly write: (site: Listed) => string;
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

/** The site a served address names by its label. The site that holds the name now is served at its own address, a public site's under its public name, at the same file. */
function servedSite(path: string): Named | undefined {
  const [label = "", ...file] = path.slice(SERVED_START.length).split("/");
  const origin = URL.parse(siteOrigin(decodeURIComponent(label)));
  const parts = origin === null ? undefined : ADDRESSES.resolve(origin);
  if (parts?.kind !== "site" || parts.name === undefined) return undefined;

  return { name: parts.name, id: parts.id, write: (site) => [servedPath(new URL(site.url).hostname), ...file].join("/") };
}

/** The site an address names with its id; none for an address of any other place. */
function namedBy(world: World, path: string): Named | undefined {
  if (path.startsWith(PANEL_PREFIX)) return panelSite(world, path);

  return path.startsWith(SERVED_START) ? servedSite(path) : undefined;
}

/**
 * Find where an address leads now whose site has an id no site has: a site's panel in the dashboard, or a site as the preview serves it.
 *
 * @param path - the path the preview was asked at
 * @returns the same place at the one site that holds the name now; `undefined` for any other path, for an id a site has, in the trash or under another name too, and for a name that none or several hold
 */
export async function addressNow(world: World, path: string): Promise<string | undefined> {
  const named = namedBy(world, path);
  if (named === undefined || (await world.install.database.getSite(named.id)) !== undefined) return undefined;

  const [only, ...others] = await sitesNamed(world, named.name);

  return only === undefined || others.length > 0 ? undefined : named.write(only);
}
