// The addresses of the console: which screen each one draws, and the section the frame marks for it.

import { clearPage } from "./lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { Screens } from "@/screens";

// The code of every screen is loaded with this file, so an address draws its screen as soon as the router asks for it: the tests are about addresses, not about loading.
import "@/access/access-screen";
import "@/activity/activity-screen";
import "@/domain/domain-screen";
import "@/settings/settings-screen";
import "@/usage/usage-screen";

/** How long the test may take, in milliseconds: it draws every screen, which on a busy machine passes the five seconds a test gets. */
const TEST_MS = 60_000;

/** How long one address may take to draw its screen and make its reads, in milliseconds. */
const SCREEN_MS = 10_000;

/** Every kind of address, and what the page shows at it. A read an earlier address made already is kept, so each address lists only what it reads anew. */
const ADDRESSES: readonly (readonly [string, Shown])[] = [
  ["/?access=public&q=a+b", ["Sites", "Sites", ["/sites?access=public&q=a+b"]]],
  ["/sites/a%20site?sort=name", ["Sites", "Sites", ["/sites/a%20site", "/sites?sort=name&dir=asc"]]],
  ["/tokens", ["Access", "Access", ["/people"]]],
  ["/tokens/list?sort=name&dir=desc", ["Access", "Access", ["/logins", "/tokens?sort=name&dir=desc"]]],
  ["/tokens/review/login-1", ["Access", "Access", ["/logins/login-1", "/tokens?sort=allowed&dir=desc"]]],
  ["/tokens/allow?code=ABCD-1234", ["Not found", "Sites", []]],
  ["/activity?kind=sites", ["Activity", "Activity", ["/activity?kind=sites"]]],
  ["/usage", ["Usage", "Usage", ["/usage", "/usage/visits?range=30"]]],
  ["/settings", ["Settings", "Settings", ["/settings"]]],
  ["/domain", ["Domain", "Domain", ["/domain"]]],
  ["/nowhere/at/all", ["Not found", "Sites", []]],
  ["/Settings", ["Not found", "Sites", []]],
];

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** Every read the screens made, as the address it asked. */
const asked: string[] = [];

/** What the page shows: the screen's title, the section marked at the side, and the reads the screen made. */
type Shown = readonly [title: string | undefined, section: string | undefined, reads: readonly string[]];

/** Go to an address as a followed link does. The reads of the address before it are forgotten, so a read that came late is counted against this one. */
async function arrive(address: string): Promise<void> {
  asked.length = 0;
  await act(async () => {
    window.history.pushState(null, "", `${BOOT.base}${address}`);
  });
}

/** Read the page. */
function shown(): Shown {
  return [
    document.querySelector("h1")?.textContent,
    document.querySelector("nav [aria-current=page]")?.textContent,
    asked.filter((path) => path !== "/frame").sort(),
  ];
}

/** Draw the console with every read refused: the tests are about which read an address makes, not about what a screen draws from the answer. */
function draw(): void {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { pathname, search } = new URL(input instanceof Request ? input.url : input, window.location.href);
    asked.push(`${pathname.slice(`${BOOT.base}/data`.length)}${search}`);

    return Response.json({ ok: false, error: "refused", says: "Refused." }, { status: 400 });
  }) as typeof fetch;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <Screens />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  globalThis.fetch = OWN_FETCH;
});
afterAll(clearPage);

describe("an address of the console", () => {
  // Drift: an address a link or the terminal already holds would draw another screen, lose its query on the way to the server, or stop being told as not there.
  test("draws its screen, marks its section, and reads what its path and query name", async () => {
    draw();

    // A screen whose code is loaded when it is first opened shows rows meanwhile, and its reads start once it is drawn: the page is read until it shows the whole of what the address names.
    for (const [address, whole] of ADDRESSES) {
      await arrive(address);
      await waitFor(() => expect({ [address]: shown() }).toEqual({ [address]: whole }), { timeout: SCREEN_MS });
    }
  }, TEST_MS);
});
