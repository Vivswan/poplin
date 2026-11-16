// A site's panel at an address from before the sample data was made anew: every seed gives each site a new id, so the address names an id no site has.
//
//   /sites/sales-report--<the id it had>   leads to   /sites/sales-report--<the id it has now>

import { listSites } from "../../../core/src/actions/list";
import { splitLabel } from "../../../core/src/sites/labels";
import type { World } from "./world";

/** What the address of a site's panel starts with, in the dashboard. */
const PANEL_PREFIX = "/sites/";

/** The labels of the sites outside the trash that hold a name, read page by page: the listing keeps every site whose name, title, or public name holds the text. */
async function labelsNamed(world: World, name: string): Promise<readonly string[]> {
  const labels: string[] = [];
  let after: Parameters<typeof listSites>[2] = {};

  while (after !== undefined) {
    const page = await listSites(world.install, world.admin, { ...after, named: name });
    if (!page.ok) return [];

    labels.push(...page.sites.filter((site) => site.name === name).map((site) => site.label));
    after = page.next === undefined ? undefined : { after: page.next };
  }

  return labels;
}

/**
 * Find the panel of the site an address means, where its id is one no site has.
 *
 * @param path - the path a page of the dashboard was asked at
 * @returns the path of the panel of the one site that holds the name now; `undefined` for any other path, for an id a site has, in the trash or under another name too, and for a name that none or several hold
 */
export async function panelNow(world: World, path: string): Promise<string | undefined> {
  if (!path.startsWith(PANEL_PREFIX)) return undefined;

  const parts = splitLabel(decodeURIComponent(path.slice(PANEL_PREFIX.length)), world.install.reservedNames);
  if (!parts.ok || parts.value.kind !== "site" || (await world.install.database.getSite(parts.value.id)) !== undefined) return undefined;

  const [only, ...others] = await labelsNamed(world, parts.value.name);

  return only === undefined || others.length > 0 ? undefined : `${PANEL_PREFIX}${only}`;
}
