// The demo inside a browser: a Service Worker that answers every request under its scope with the demo's own handler. No server takes part once the files are loaded.
//
//   a navigation while no demo page is open     a new visit: the demo starts over from the seed
//   any other request, the demo not running     the browser stopped the worker: the demo goes on from what was saved
//   any request, and nothing was saved          a new build took the page over: the demo starts from the seed, and each open page of the dashboard loads anew when it next asks
//
// A browser stops an idle worker after about half a minute, so after every answer the whole demo is written to IndexedDB.
// The dashboard's client is no part of this script: its files sit beside it on the host, and each is read from there the first time a page asks for it.

import { createStore, del, get, set } from "idb-keyval";
import { base64ToUint8Array } from "uint8array-extras";

import type { ClientFiles } from "../../../app/src/console/shell";
import { SERVED_PREFIX } from "../preview/addresses/mount";
import { REAL_SITES_FILE, type RealSites, readRealSites } from "../preview/world/real-sites";
import type { Samples } from "../preview/world/seed";
// The first module of the bundle to run: every other one builds its requests and responses with the classes this one puts in place.
import { plainResponse } from "./free-headers";
import { openKeptDemo, type SavedDemo } from "./kept-demo";
import { loadSqlite } from "./sqljs-driver";
import { stalePages } from "./stale-pages";

declare const self: ServiceWorkerGlobalScope;

/** What the build puts in place of this name: a tag of the worker's own content and of SQLite's file, so each build has its own. */
declare const BUILD: string;

/** What the build puts in place of this name: the version of poplin the demo was built from. */
declare const VERSION: string;

/** What the build puts in place of this name: every sample site as its entry page's own title, `null` for none, and each file as its path, its media type, and its bytes in base64. */
declare const PACKED_SAMPLES: Readonly<Record<string, readonly [title: string | null, files: readonly (readonly [path: string, contentType: string, base64: string])[]]>>;

/** What the build puts in place of this name: the names of the client's script and stylesheet, and of every file of the client. */
declare const CLIENT: { readonly entry: { readonly script: string; readonly style: string }; readonly names: readonly string[] };

/** The path the demo sits under, without its last slash: empty at the root of an origin. */
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

/** Where SQLite's WebAssembly file is: beside this script. */
const WASM = new URL(`sql-wasm.wasm?v=${BUILD}`, self.registration.scope).href;

/** Where the dashboard's client is: in a folder beside this script. */
const CLIENT_FOLDER = new URL("assets/", self.registration.scope).href;

/** Where the host keeps the real addresses of the sample sites, if it has them: beside this script. */
const REAL_SITES = new URL(REAL_SITES_FILE, self.registration.scope).href;

/** What the address of every sample site the demo serves starts with. */
const SERVED = new URL(`.${SERVED_PREFIX}/`, self.registration.scope).href;

/** The media type of a file whose host names none. */
const NO_TYPE = "application/octet-stream";

/** What the name of every cache of the demo starts with. */
const CACHE_PREFIX = "poplin-demo-";

/** The cache that holds SQLite's file and the client's, so a start after the first needs no network. */
const CACHE = `${CACHE_PREFIX}${BUILD}`;

/** The demo's one object store in IndexedDB. */
const STORE = createStore("poplin-demo", "demo");

/** The key the demo is saved under. */
const SAVED_KEY = "saved";

/** What is written to IndexedDB: the demo, the build that saved it, and the id of each open page that still shows the data of before the seed. */
interface Kept {
  readonly build: string;
  readonly demo: SavedDemo;
  readonly stale: readonly string[];
}

/** The demo that answers now, or the start of it. A start that failed is tried again by the next request. */
let running: ReturnType<typeof openKeptDemo> | undefined;

/** The last write to IndexedDB, which the next one waits for. */
let written: Promise<unknown> = Promise.resolve();

/** Whether a write waits its turn: it takes the demo as it is when it starts, so one write covers every answer before it. */
let waiting = false;

/** The pages drawn before the demo last started from the seed, by the id of each, and the loading anew of each one that has begun. */
const stale = new Map<string, Promise<boolean> | undefined>();

/** A browser may shut IndexedDB to a worker. The demo then runs without it, and starts over when the browser stops the worker. */
function unkept(error: unknown): undefined {
  console.warn("demo: nothing is kept across a stop of the worker", error);

  return undefined;
}

/** What a worker of this build saved, if anything. */
async function readSaved(): Promise<Kept | undefined> {
  try {
    const saved = await get<Kept>(SAVED_KEY, STORE);

    return saved?.build === BUILD ? saved : undefined;
  } catch (error) {
    return unkept(error);
  }
}

/** Drop what a worker saved. */
async function dropSaved(): Promise<void> {
  try {
    await del(SAVED_KEY, STORE);
  } catch (error) {
    unkept(error);
  }
}

/** Write the demo and the pages that are stale to IndexedDB, after the write before it. */
function save(demo: Awaited<NonNullable<typeof running>>): Promise<unknown> {
  if (waiting) return written;

  waiting = true;
  written = written
    .then(() => {
      waiting = false;

      return set(SAVED_KEY, { build: BUILD, demo: demo.save(), stale: [...stale.keys()] } satisfies Kept, STORE);
    })
    .catch(unkept);

  return written;
}

/** A file the host serves beside this script: from the cache, or from the host once. `undefined` for a file the host does not have. */
async function hosted(address: string): Promise<Response | undefined> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(address);
  if (cached !== undefined) return cached;

  const fetched = await fetch(address);
  if (!fetched.ok) return undefined;

  await cache.put(address, fetched.clone());

  return fetched;
}

async function wasmBytes(): Promise<ArrayBuffer> {
  const file = await hosted(WASM);
  if (file === undefined) throw new Error("SQLite's file did not load");

  return file.arrayBuffer();
}

/** One file of the dashboard's client, as the host serves it. A name the build did not write is never asked of the host. */
async function clientFile(name: string): ReturnType<ClientFiles["file"]> {
  const file = CLIENT.names.includes(name) ? await hosted(new URL(name, CLIENT_FOLDER).href) : undefined;
  if (file === undefined) return undefined;

  return { body: new Uint8Array(await file.arrayBuffer()), type: file.headers.get("Content-Type") ?? NO_TYPE };
}

/** The real addresses the host has now, asked anew at every start: an install that holds the sample sites makes them again, at other addresses. `undefined` for a host without the file, with one that is no JSON, or one that cannot be reached. */
async function realSites(): Promise<RealSites | undefined> {
  try {
    const answered = await fetch(REAL_SITES, { cache: "no-store" });

    return answered.ok ? readRealSites(await answered.json()) : undefined;
  } catch {
    return undefined;
  }
}

function samples(): Samples {
  const unpacked = Object.entries(PACKED_SAMPLES).map(([name, [title, packed]]) => {
    const files = packed.map(([path, contentType, base64]) => ({ path, contentType, bytes: base64ToUint8Array(base64) }));

    return [name, title === null ? { files } : { files, title }] as const;
  });

  return Object.fromEntries(unpacked);
}

/** Start the demo: from what a worker saved, or from the seed. */
async function start(saved: SavedDemo | undefined): ReturnType<typeof openKeptDemo> {
  const client: ClientFiles = { entry: async () => CLIENT.entry, file: clientFile };

  return openKeptDemo({ sqlite: await loadSqlite(await wasmBytes()), samples: samples(), version: VERSION, base: BASE, client, saved, real: await realSites() });
}

/**
 * Whether a script of a page drawn before the demo last started from the seed made a request: only such a request names the page's own address as its referrer.
 *
 * A file such a page loads is the same over any data, and a page that asks for itself is drawn anew.
 */
function isStale(event: FetchEvent): boolean {
  return event.request.mode !== "navigate" && event.request.destination === "" && stale.has(event.clientId);
}

/**
 * Load anew the page a request came from, at the address it shows now, which its request names as its referrer: a browser may tell a worker only the address a page was first loaded at.
 *
 * @returns whether the page loads anew; one that cannot is stale no longer, and is answered as it is
 */
async function loadAnew(event: FetchEvent): Promise<boolean> {
  const { referrer } = event.request;
  const page = await self.clients.get(event.clientId).catch(() => undefined);
  const shown = (first: string): string => (referrer.startsWith(self.registration.scope) ? referrer : first);
  const loads = page instanceof WindowClient && (await page.navigate(shown(page.url)).then(() => true, () => false));
  if (!loads) stale.delete(event.clientId);

  return loads;
}

/** Whether the page a stale request came from loads anew: the first such request of a page begins it, and every other one waits for it. */
function loadsAnew(event: FetchEvent): Promise<boolean> {
  const begun = stale.get(event.clientId) ?? loadAnew(event);
  stale.set(event.clientId, begun);

  return begun;
}

/** The open pages that show sites that are gone, after a start from the seed for a request, as when a new build took an open page over. */
async function drawnBefore(event: FetchEvent): Promise<readonly string[]> {
  const pages = await self.clients.matchAll({ type: "window" });

  return stalePages(pages, { mode: event.request.mode, clientId: event.clientId, resultingClientId: event.resultingClientId }, SERVED);
}

/**
 * Start the demo for a request, with the pages that are stale: the ones a worker saved, or after a start from the seed the ones open now.
 *
 * A demo that started from the seed is saved at once: its pages name sites a second seed would name otherwise.
 */
async function startFor(event: FetchEvent, opensVisit: boolean): ReturnType<typeof openKeptDemo> {
  const saved = opensVisit ? undefined : await readSaved();
  const demo = await start(saved?.demo);
  const ids = saved?.stale ?? (await drawnBefore(event));
  stale.clear();
  for (const id of ids) stale.set(id, undefined);

  if (saved === undefined) await save(demo);

  return demo;
}

/** The demo this request is answered by: the running one, the saved one, or a new one when the request opens a visit. */
async function demoFor(event: FetchEvent): ReturnType<typeof openKeptDemo> {
  const opensVisit = event.request.mode === "navigate" && (await self.clients.matchAll({ type: "window" })).length === 0;

  if (opensVisit || running === undefined) {
    const starting = startFor(event, opensVisit);
    running = starting;
    starting.catch(() => {
      if (running === starting) running = undefined;
    });
  }

  return running;
}

async function answer(event: FetchEvent): Promise<Response> {
  const demo = await demoFor(event);
  // A page drawn from the data before is loaded anew; what it asked meanwhile is never done to the new data.
  if (isStale(event) && (await loadsAnew(event))) return new Response("The demo started over. This page loads again by itself.\n", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  const response = await demo.fetch(event.request);
  event.waitUntil(save(demo));

  return plainResponse(response);
}

async function dropOldCaches(): Promise<void> {
  const old = (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE);
  await Promise.all(old.map((name) => caches.delete(name)));
}

self.addEventListener("install", (event) => {
  // A new build takes over at once and starts from the seed: what an older build saved may not fit it.
  event.waitUntil(Promise.all([wasmBytes(), dropSaved(), self.skipWaiting()]));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([dropOldCaches(), self.clients.claim()]));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !(url.pathname === BASE || url.pathname.startsWith(`${BASE}/`))) return;

  const failed = (error: unknown): Response => {
    console.error("demo: a request failed", error);

    return new Response("The demo failed on this request. Reload the page to start it again.\n", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };

  event.respondWith(answer(event).then(undefined, (error: unknown) => plainResponse(failed(error))));
});
