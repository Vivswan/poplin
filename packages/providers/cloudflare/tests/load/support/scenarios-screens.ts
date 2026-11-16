// What each screen of the dashboard costs as the install grows: its sites, its log, and its users.

import type { Fill } from "../../../load/profiles";
import { siteId } from "../../shared/worker/support/budget-seeds";
import { get, sessionOf, type Stage } from "../../shared/worker/support/budget-stage";
import { ADMIN } from "../../shared/worker/support/install";
import { fillInstall, labelOf, visitsOf } from "./fill";
import type { Scenario } from "./measure";

/** The entries the largest page of the Activity screen holds. */
const ACTIVITY_PAGE = 200;

/** The days a graph of visits reads: the longest stretch drawn day by day, and the longest one, drawn week by week. */
const GRAPH = { daily: 90, year: 365 } as const;

/**
 * The owner's request for one address of the dashboard of a filled install.
 *
 * @param path - the address under the admin hostname; a function is asked once the install is filled, and may seed more
 */
function screen(name: string, axis: Scenario["axis"], path: string | ((stage: Stage, fill: Fill) => Promise<string>), known?: string): Scenario {
  return {
    name,
    axis,
    flat: true,
    status: 200,
    ...(known === undefined ? {} : { known }),
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const address = typeof path === "string" ? path : await path(stage, fill);
      const session = await sessionOf(stage);

      return (measured) => get(measured, `${ADMIN}${address}`, session);
    },
  };
}

/** The dashboard's screens. */
export const SCREEN_SCENARIOS: readonly Scenario[] = [
  screen("dashboard first load: the page", "sites", "/"),
  screen("dashboard first load: the frame", "sites", "/data/frame"),
  screen("Sites list: the first page", "sites", "/data/sites"),
  screen("Sites list: sorted by title", "sites", "/data/sites?sort=title&dir=desc"),
  screen("Sites list: sorted by name", "sites", "/data/sites?sort=name&dir=desc"),
  screen("Sites list: sorted by access", "sites", "/data/sites?sort=access&dir=desc"),
  screen("Sites list: searched, many found", "sites", "/data/sites?q=site"),
  screen("Sites list: searched, none found", "sites", "/data/sites?q=nothing-is-named-so", "a search passes over every site that does not match"),
  screen("Sites list: the trash", "sites", "/data/sites?view=trash"),
  screen("a site's panel", "sites", `/data/sites/${labelOf(1)}`),
  screen("Activity: the largest page", "entries", `/data/activity?size=${ACTIVITY_PAGE}`),
  screen("Activity: narrowed to one site", "entries", `/data/activity?size=${ACTIVITY_PAGE}&of=${siteId(1)}`),
  screen("Activity: the count of entries", "entries", "/data/activity/total"),
  screen("Activity: download a file", "entries", "/data/activity/download?part=1"),
  screen("Activity: where the next file goes on", "entries", "/data/activity/download/next"),
  screen("Usage", "sites", "/data/usage"),
  screen("Usage: 90 days of visits, 50 sites compared", "sites", async (stage, fill) => `/data/usage/visits?range=${GRAPH.daily}&sites=${await visitsOf(stage, fill, GRAPH.daily)}`),
  screen("Usage: a year of visits, 50 sites compared", "sites", async (stage, fill) => `/data/usage/visits?range=${GRAPH.year}&sites=${await visitsOf(stage, fill, GRAPH.year)}`),
  screen("Access: the people", "users", "/data/people"),
  screen("Access: the tokens", "users", "/data/tokens"),
  screen("Settings", "users", "/data/settings"),
];
