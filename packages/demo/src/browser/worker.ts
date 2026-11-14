// The demo inside a browser: a Service Worker that answers every request under its scope with the demo's own handler. No server takes part once the files are loaded.
//
//   a navigation while no demo page is open     a new visit: the demo starts over from the seed
//   any other request, the demo not running     the browser stopped the worker: the demo goes on from what was saved
//
// A browser stops an idle worker after about half a minute, so after every answer the whole demo is written to IndexedDB.

import type { Samples } from "../preview/seed";
// The first module of the bundle to run: every other one builds its requests and responses with the classes this one puts in place.
import { plainResponse } from "./free-headers";
import { openKeptDemo, type SavedDemo } from "./kept-demo";
import { loadSqlite } from "./sqljs-driver";

declare const self: ServiceWorkerGlobalScope;

/** What the build puts in place of this name: a tag of the worker's own content and of SQLite's file, so each build has its own. */
declare const BUILD: string;

/** What the build puts in place of this name: every sample site, each file as its path, its media type, and its bytes in base64. */
declare const PACKED_SAMPLES: Readonly<Record<string, readonly (readonly [path: string, contentType: string, base64: string])[]>>;

/** The path the demo sits under, without its last slash: empty at the root of an origin. */
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");

/** Where SQLite's WebAssembly file is: beside this script. */
const WASM = new URL(`sql-wasm.wasm?v=${BUILD}`, self.registration.scope).href;

/** What the name of every cache of the demo starts with. */
const CACHE_PREFIX = "poplin-demo-";

/** The cache that holds SQLite's file, so a start after the first needs no network. */
const CACHE = `${CACHE_PREFIX}${BUILD}`;

/** The IndexedDB database, its one object store, and the key the demo is saved under. */
const KEPT = { database: "poplin-demo", store: "demo", key: "saved" } as const;

/** What is written to IndexedDB: the demo, and the build that saved it. */
interface Kept {
  readonly build: string;
  readonly demo: SavedDemo;
}

/** The demo that answers now, or the start of it. A start that failed is tried again by the next request. */
let running: ReturnType<typeof openKeptDemo> | undefined;

/** The last write to IndexedDB, which the next one waits for. */
let written: Promise<unknown> = Promise.resolve();

/** Whether a write waits its turn: it takes the demo as it is when it starts, so one write covers every answer before it. */
let waiting = false;

/** Run one request against the demo's store in IndexedDB, to the end of its transaction: a write that was asked for can still be undone until then. */
async function kept<Result>(mode: IDBTransactionMode, ask: (store: IDBObjectStore) => IDBRequest<Result>): Promise<Result> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open(KEPT.database, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(KEPT.store);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });

  try {
    return await new Promise<Result>((resolve, reject) => {
      const transaction = database.transaction(KEPT.store, mode);
      const asked = ask(transaction.objectStore(KEPT.store));
      transaction.oncomplete = () => resolve(asked.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/** A browser may shut IndexedDB to a worker. The demo then runs without it, and starts over when the browser stops the worker. */
function unkept(error: unknown): undefined {
  console.warn("demo: nothing is kept across a stop of the worker", error);

  return undefined;
}

/** The demo a worker of this build saved, if any. */
async function readSaved(): Promise<SavedDemo | undefined> {
  const saved: Kept | undefined = await kept("readonly", (store) => store.get(KEPT.key)).catch(unkept);

  return saved?.build === BUILD ? saved.demo : undefined;
}

/** Write the demo to IndexedDB, after the write before it. */
function save(demo: Awaited<NonNullable<typeof running>>): Promise<unknown> {
  if (waiting) return written;

  waiting = true;
  written = written
    .then(() => {
      waiting = false;

      return kept("readwrite", (store) => store.put({ build: BUILD, demo: demo.save() } satisfies Kept, KEPT.key));
    })
    .catch(unkept);

  return written;
}

/** SQLite's file: from the cache, or from the host once. */
async function wasmBytes(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(WASM);
  if (cached !== undefined) return cached.arrayBuffer();

  const fetched = await fetch(WASM);
  if (!fetched.ok) throw new Error(`SQLite's file did not load: ${fetched.status}`);

  await cache.put(WASM, fetched.clone());

  return fetched.arrayBuffer();
}

function samples(): Samples {
  const unpacked = Object.entries(PACKED_SAMPLES).map(([name, files]) => {
    const read = files.map(([path, contentType, base64]) => ({
      path,
      contentType,
      bytes: Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
    }));

    return [name, read] as const;
  });

  return Object.fromEntries(unpacked);
}

/** Start the demo, and save one that started from the seed: its pages name sites a second seed would name otherwise. */
async function start(saved: SavedDemo | undefined): ReturnType<typeof openKeptDemo> {
  const demo = await openKeptDemo({ sqlite: await loadSqlite(await wasmBytes()), samples: samples(), base: BASE, saved });
  if (saved === undefined) await save(demo);

  return demo;
}

/** The demo this request is answered by: the running one, the saved one, or a new one when the request opens a visit. */
async function demoFor(request: Request): ReturnType<typeof openKeptDemo> {
  const opensVisit = request.mode === "navigate" && (await self.clients.matchAll({ type: "window" })).length === 0;

  if (opensVisit || running === undefined) {
    const starting = (async () => start(opensVisit ? undefined : await readSaved()))();
    running = starting;
    starting.catch(() => {
      if (running === starting) running = undefined;
    });
  }

  return running;
}

async function answer(event: FetchEvent): Promise<Response> {
  const demo = await demoFor(event.request);
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
  event.waitUntil(Promise.all([wasmBytes(), kept("readwrite", (store) => store.delete(KEPT.key)).catch(unkept), self.skipWaiting()]));
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
