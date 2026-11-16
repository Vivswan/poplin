// A page for the component tests: a document, and the data block the client starts from. The package's own test run loads it before any test file, so the document is there when React's DOM half is first loaded.
//
// A check that is tried again until it holds compares words, counts, or true and false, never an element: a failed comparison of an element writes out the whole page the element hangs in, which takes seconds each try.
//
// The page stays for every test file of the run, which is the client's alone: `bun run test` in this package. The runtime's own `fetch`, `Request`, `Response`, and `Headers` are put back at once, so a test still calls them.

import { afterAll, afterEach, beforeEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { BoundFunctions, queries } from "@testing-library/react";

/** The start values every component test runs under. */
const TEST_BOOT = {
  base: "/next",
  email: "mira@example.com",
  title: "poplin",
  version: "1.0.0",
  update: null,
  starts: false,
  back: null,
  demo: null,
  domain: true,
  domainNote: null,
  recent: [],
  marks: { usage: null, domain: null, settings: null },
  domainAsks: 0,
};

/** What of the runtime the page must not replace: the tests that run after it call these. */
const OWN = { fetch: globalThis.fetch, Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };

/** The queries of one part of the page. The library's own type of what `within` gives names no query, so what a query finds would have no type. */
export type Within = BoundFunctions<typeof queries>;

function keptKeys(): readonly string[] {
  return [window.localStorage, window.sessionStorage].flatMap((store) => [...Array(store.length).keys()].map((at) => store.key(at) ?? ""));
}

function emptyStores(): void {
  window.localStorage.clear();
  window.sessionStorage.clear();
}

/** Emptied before the throw, so one left key fails one test and not every test after it. */
function refuseKept(): void {
  const keys = keptKeys();
  if (keys.length === 0) return;

  emptyStores();
  throw new Error(`left: ${keys.join(", ")}`);
}

/** The library keeps every said line for the whole run, so one left would be drawn where a later test draws its lines. It is loaded here, once the page is there. */
async function takeLinesAway(): Promise<void> {
  const { toast } = await import("sonner");
  toast.dismiss();
}

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "https://poplin.example.com/next/" });
  Object.assign(globalThis, OWN);
}

if (document.getElementById("boot") === null) {
  const block = document.createElement("script");
  block.type = "application/json";
  block.id = "boot";
  block.textContent = JSON.stringify(TEST_BOOT);
  document.head.append(block);
}

// Every test file shares the page's two stores and the lines that say results, so what one file left would be the state another starts from. Hooks set here hold for every file: the first two run around each test, the last once the whole run ends.
beforeEach(refuseKept);
afterEach(emptyStores);
afterEach(takeLinesAway);
afterAll(refuseKept);

/** Empty the page a test file drew into, so the file that follows starts from an empty body. */
export async function clearPage(): Promise<void> {
  document.body.replaceChildren();
}
