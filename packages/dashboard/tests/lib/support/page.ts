// A page for the component tests: a document, and the data block the client starts from. The package's own test run loads it before any test file, so the document is there when React's DOM half is first loaded.
//
// A check that is tried again until it holds compares words, counts, or true and false, never an element: a failed comparison of an element writes out the whole page the element hangs in, which takes seconds each try.
//
// The page stays for every test file of the run, which is the client's alone: `bun run test` in this package. The runtime's own `fetch`, `Request`, `Response`, and `Headers` are put back at once, so a test still calls them.

import { GlobalRegistrator } from "@happy-dom/global-registrator";

/** The start values every component test runs under. */
const TEST_BOOT = { base: "/next", email: "mira@example.com", title: "poplin", version: "1.0.0", update: null, starts: false, demo: null, domain: true, domainNote: null };

/** What of the runtime the page must not replace: the tests that run after it call these. */
const OWN = { fetch: globalThis.fetch, Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };

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

/** Empty the page a test file drew into, so the file that follows starts from an empty body. */
export async function clearPage(): Promise<void> {
  document.body.replaceChildren();
}
