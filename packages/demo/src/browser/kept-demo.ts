// The demo as a host keeps it that can be stopped at any moment: everything it holds is handed out by `save`, and a demo opened from that goes on where the first one was.
//
//   what a save holds   the two installs' databases and their stored files

import type { SqlJsStatic } from "sql.js";

import type { ClientFiles } from "../../../app/src/console/shell";
import { insidePath } from "../preview/base";
import { createPreview } from "../preview/preview";
import type { RealSites } from "../preview/real-sites";
import type { Samples } from "../preview/seed";
import { KeptStore, type SavedStore } from "./kept-store";
import { SqlJsDriver } from "./sqljs-driver";

/** The installs the demo opens, at its start and again at every reset: the seeded one, then the one that holds nothing. */
const INSTALLS = 2;

/** The header a served site sends to make a browser drop what it holds of the site's origin. */
const ORIGIN_WIDE_HEADER = "Clear-Site-Data";

/** The header that sets a page's opener policy, which the host's first page has none of. */
const OPENER_POLICY_HEADER = "Cross-Origin-Opener-Policy";

/** The query key under which the host's 404 page hands a deep link to the demo's first page. */
const DEEP_LINK_KEY = "to";

/** Where a visitor finds why a request failed: the demo runs in a worker of the browser, which has no terminal. */
const REASON_AT = "The console of this page's service worker, in the browser's developer tools, says why.";

/** Everything a demo holds, in the order its installs were opened. Structured cloning carries it whole. */
export interface SavedDemo {
  /** The SQLite file of each install. */
  readonly databases: readonly Uint8Array[];

  /** The stored objects of each install. */
  readonly stores: readonly SavedStore[];
}

/** What a demo is opened from. */
interface KeptHost {
  /** The loaded SQLite module. */
  readonly sqlite: SqlJsStatic;

  /** The version of poplin the demo's installs say they run. */
  readonly version: string;

  /** The files of every sample site the seed publishes. */
  readonly samples: Samples;

  /** The path the demo sits under at its origin, such as `/poplin/demo`; empty at the root. */
  readonly base: string;

  /** The dashboard's client, as the host hands its files out. */
  readonly client: ClientFiles;

  /** What an earlier demo's `save` handed out; left out, the demo starts from the seed. */
  readonly saved?: SavedDemo;

  /** The real address of each sample site, where the host of the demo's files has them. */
  readonly real?: RealSites;
}

/** A running demo. */
interface KeptDemo {
  /** Answers one request of the browser, as a server in front of the demo would hand it on. */
  readonly fetch: (request: Request) => Promise<Response>;

  /** Hands out everything the demo holds now. */
  readonly save: () => SavedDemo;
}

/** What one install is opened over, as lists a reset begins anew. */
interface Held {
  readonly databases: SqlJsDriver[];
  readonly stores: KeptStore[];
}

/** The databases of the installs before the last reset. A request that began before that reset may still read them, so they are closed at the reset after it. */
type Retired = SqlJsDriver[];

/** Hold one more thing of an install. The first thing after every install has one belongs to a reset, which leaves the earlier installs behind. */
function held<Item>(list: Item[], item: Item): Item {
  if (list.length === INSTALLS) list.length = 0;

  list.push(item);

  return item;
}

/** Where a deep link leads that came back through the demo's first page as `?to=<path>`: a static host has no file for a page inside the demo. A path that leads out of the demo is none, and the first page answers. */
function deepLink(request: Request, base: string): string | undefined {
  const url = new URL(request.url);
  const to = url.searchParams.get(DEEP_LINK_KEY);
  if (request.method !== "GET" || url.pathname !== `${base}/` || to === null) return undefined;

  // The path is one from the demo's root, so it is read from the demo's folder.
  return insidePath(`.${to}`, `${base}/`);
}

/**
 * Open the demo: from what an earlier one saved, or from the seed.
 *
 * @returns the demo; nothing it holds leaves it but through `save`
 * @throws {Error} the seed was refused, or a saved database did not open
 */
export async function openKeptDemo(host: KeptHost): Promise<KeptDemo> {
  const { saved } = host;
  const left = { databases: [...(saved?.databases ?? [])], stores: [...(saved?.stores ?? [])] };
  const now: Held = { databases: [], stores: [] };
  const retired: Retired = [];

  // SQLite's memory is outside the garbage collector's reach: a database is given back only when it is closed.
  const openDriver = (): SqlJsDriver => {
    if (now.databases.length === INSTALLS) {
      for (const driver of retired.splice(0)) driver.close();

      retired.push(...now.databases);
    }

    return held(now.databases, new SqlJsDriver(host.sqlite, left.databases.shift()));
  };

  const preview = await createPreview({
    samples: host.samples,
    version: host.version,
    base: host.base,
    client: host.client,
    reasonAt: REASON_AT,
    resumed: saved !== undefined,
    real: host.real,
    openDriver,
    openStore: () => held(now.stores, new KeptStore(left.stores.shift())),
  });

  return {
    fetch: async (request) => {
      const sentOn = deepLink(request, host.base);
      if (sentOn !== undefined) return new Response(null, { status: 302, headers: { Location: sentOn } });

      const response = await preview.fetch(request);
      // The header speaks for the whole origin, which a static host shares with pages that are not the demo's.
      response.headers.delete(ORIGIN_WIDE_HEADER);
      // A policy the host's first page lacks moves the dashboard's page out of the worker's process in WebKit, which ends a process with no page when memory runs short.
      response.headers.delete(OPENER_POLICY_HEADER);

      return response;
    },
    save: () => ({
      databases: now.databases.map((driver) => driver.save()),
      stores: now.stores.map((store) => store.save()),
    }),
  };
}
