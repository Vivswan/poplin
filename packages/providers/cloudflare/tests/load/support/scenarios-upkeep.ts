// What the upkeep of an install costs as it grows: removing a site, the scheduled run, and a backup's reads.

import type { Fill } from "../../../load/profiles";
import { siteId } from "../../shared/worker/support/budget-seeds";
import { adminToken, apiOf, type Measured, sql, type Stage } from "../../shared/worker/support/budget-stage";
import { type ApiCalls, instance, sweep } from "../../shared/worker/support/install";
import { fillInstall } from "./fill";
import type { Scenario, Turn } from "./measure";

/** The sites of a fill that no other request is about: every site after the first three. */
const FIRST_SPARE = 4;

/** The most sites one page of a listing holds. */
const LARGEST_PAGE = 100;

/** How long ago the sites of a trash to sweep were put there: past the seven days the first settings of the tests' install keep one. */
const TRASHED_AGO_MS = 8 * 86_400_000;

/** How many spare sites a fill holds. */
function spares(fill: Fill): number {
  return Math.max(3, fill.sites) - FIRST_SPARE + 1;
}

/** A request of an admin's token to the API of a filled install. */
function asked(name: string, axis: Scenario["axis"], call: (api: ApiCalls, turn: number, fill: Fill) => ReturnType<Turn>, more: Pick<Scenario, "turns"> & { readonly flat?: boolean } = {}): Scenario {
  return {
    name,
    axis,
    flat: more.flat ?? true,
    status: 200,
    ...(more.turns === undefined ? {} : { turns: more.turns }),
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      const token = await adminToken(stage);

      return (measured, turn) => call(apiOf(measured, token), turn, fill);
    },
  };
}

/** One scheduled run on the measured instance. */
async function run(measured: Measured): Promise<undefined> {
  await sweep(measured.worker, measured.w, measured.bindings);

  return undefined;
}

/** A scheduled run on a filled install that has run once before, so the run starts nothing for the first time. */
function scheduled(name: string, axis: Scenario["axis"], seed: (stage: Stage) => Promise<void> = async () => undefined): Scenario {
  return {
    name,
    axis,
    flat: true,
    status: undefined,
    arrange: async (stage, fill) => {
      await fillInstall(stage, fill);
      await sweep(instance(stage.w), stage.w);
      await seed(stage);

      return run;
    },
  };
}

/** Removing a site, the scheduled run, and the reads of a backup. */
export const UPKEEP_SCENARIOS: readonly Scenario[] = [
  asked("delete a site: to the trash", "sites", (api, turn) => api.sites[":site"].$delete({ param: { site: siteId(FIRST_SPARE + turn) }, query: {} }), { turns: spares }),
  asked("delete a site for good", "sites", (api, turn) => api.sites[":site"].$delete({ param: { site: siteId(FIRST_SPARE + turn) }, query: { no_trash: "true" } }), { turns: spares }),
  asked("delete a site for good: its files", "files", (api) => api.sites[":site"].$delete({ param: { site: siteId(1) }, query: { no_trash: "true" } }), { turns: () => 1, flat: false }),
  scheduled("scheduled run: nothing due", "sites"),
  scheduled("scheduled run: nothing due, a long log", "entries"),
  scheduled("scheduled run: the trash sweep, every spare site past its days", "sites", (stage) => sql("UPDATE sites SET trashed_at = ?1 WHERE id >= ?2", stage.w.clock.now - TRASHED_AGO_MS, siteId(FIRST_SPARE))),
  asked("list the sites: the largest page", "sites", (api) => api.sites.$get({ query: { limit: String(LARGEST_PAGE) } })),
  asked("export: a page of sites, every version", "sites", (api) => api.export.sites.$get({ query: { limit: String(LARGEST_PAGE), all_versions: "true" } })),
  asked("export: a page of a version's files", "files", (api) => api.export.sites[":site"].files.$get({ param: { site: siteId(1) }, query: { version: "1" } }), { flat: false }),
  asked("export: one file", "files", (api) => api.export.sites[":site"].file.$get({ param: { site: siteId(1) }, query: { version: "1", path: "index.html" } })),
  asked("export: the settings", "users", (api) => api.export.settings.$get({ query: {} })),
  asked("read the log: the largest page", "entries", (api) => api.audit.$get({ query: { limit: String(LARGEST_PAGE) } })),
];
