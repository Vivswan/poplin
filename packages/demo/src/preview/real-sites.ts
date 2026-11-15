// The real addresses of the sample sites, where a host of the demo has them: an install that holds the same sites, each open to the same people.
//
//   sites.json, beside the demo's files   { "<a sample site's name>": "https://<its address on that install>/" }
//   a link of the dashboard to that site  leads to that address
//   the link to the demo's own site       leads to the demo's dashboard: a host with such a file is that site
//   a name the file lacks, or no file     the link leads to the site as the demo serves it itself
//
// The addresses are link targets and nothing else: the demo asks none of them for anything.

import { listSites } from "../../../core/src/actions/list";
import { ADMIN_ORIGIN } from "./mount";
import { standingSites, THE_DEMO } from "./sample-sites";
import type { World } from "./world";

/** The name of the file, beside the demo's first page. */
export const REAL_SITES_FILE = "sites.json";

/** The real address of each sample site that has one, by the site's name. */
export type RealSites = Readonly<Record<string, string>>;

/** Whether a value is an address a link may lead to: the root of an https origin, written as a browser writes it, with no login, port, query, or fragment. */
function isRoot(address: unknown): address is string {
  if (typeof address !== "string") return false;

  const url = URL.parse(address);
  if (url === null || url.protocol !== "https:" || url.port !== "") return false;

  return url.username === "" && url.password === "" && url.href === address && address === `${url.origin}/`;
}

/**
 * Read what a host's file of real addresses holds.
 *
 * @param data - the file as parsed JSON; anything at all
 * @returns the entries that are the root of an https origin; every other entry is left out, and a file that is no object gives none
 */
export function readRealSites(data: unknown): RealSites {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};

  return Object.fromEntries(Object.entries(data).filter(([, address]) => isRoot(address)));
}

/**
 * Find where the link to each sample site leads instead of to the demo's own serving of it.
 *
 * A site counts while it is the one site outside the trash under its name, with the access and the title the sample table ends in: one a visitor renamed, retitled, moved to the trash, or opened to other people is the demo's own again.
 *
 * @param real - what the host's file holds; `undefined` for a host without one
 * @returns the address of each such site, by the hostname the demo's install gives it; none for a host without a file. The row that stands for the demo itself leads to the demo's dashboard
 */
export async function realAddresses(world: World, real: RealSites | undefined): Promise<ReadonlyMap<string, string>> {
  const found = new Map<string, string>();
  if (real === undefined) return found;

  const rows = new Map(standingSites().map((row) => [row.name, row]));
  const listed = await listSites(world.install, world.admin);

  const sites = listed.ok ? listed.sites : [];

  for (const site of sites) {
    const row = rows.get(site.name);
    const typed = site.title_typed ? site.title : null;
    const isRow = row?.reach.access === site.access && (row.settings.title ?? null) === typed && sites.filter((other) => other.name === site.name).length === 1;
    if (row === undefined || !isRow) continue;

    const address = row.sample === THE_DEMO ? `${ADMIN_ORIGIN}/` : real[site.name];
    if (address !== undefined) found.set(new URL(site.url).hostname, address);
  }

  return found;
}
