// The addresses of the console: which screen each one draws, and the section the frame marks for it.

import { clearPage } from "./lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { Screens } from "@/screens";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** Every read the screens made, as the address it asked. */
const asked: string[] = [];

/** Go to an address as a followed link does, and let the screen it names be drawn and ask for its data. */
async function arrive(address: string): Promise<void> {
  asked.length = 0;
  await act(async () => {
    window.history.pushState(null, "", `${BOOT.base}${address}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** What the page shows: the screen's title, the section marked at the side, and the reads the screen made. */
function shown(): readonly [string | undefined, string | undefined, readonly string[]] {
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

    const drawn: Record<string, ReturnType<typeof shown>> = {};
    for (const address of [
      "/?access=public&q=a+b",
      "/sites/a%20site?sort=name",
      "/tokens",
      "/tokens/list?sort=name&dir=desc",
      "/tokens/review/login-1",
      "/tokens/allow?code=ABCD-1234",
      "/activity?kind=sites",
      "/usage",
      "/settings",
      "/domain",
      "/nowhere/at/all",
      "/Settings",
    ]) {
      await arrive(address);
      drawn[address] = shown();
    }

    // A read an earlier address made already is kept, so each address lists only what it reads anew.
    expect(drawn).toEqual({
      "/?access=public&q=a+b": ["Sites", "Sites", ["/sites?access=public&q=a+b"]],
      "/sites/a%20site?sort=name": ["Sites", "Sites", ["/sites/a%20site", "/sites?sort=name&dir=asc"]],
      "/tokens": ["Access", "Access", ["/people"]],
      "/tokens/list?sort=name&dir=desc": ["Access", "Access", ["/logins", "/tokens?sort=name&dir=desc"]],
      "/tokens/review/login-1": ["Access", "Access", ["/logins/login-1", "/tokens?sort=allowed&dir=desc"]],
      "/tokens/allow?code=ABCD-1234": ["Access", "Access", ["/logins/find?code=ABCD-1234"]],
      "/activity?kind=sites": ["Activity", "Activity", ["/activity?kind=sites"]],
      "/usage": ["Usage", "Usage", ["/usage", "/usage/visits?range=30"]],
      "/settings": ["Settings", "Settings", ["/settings"]],
      "/domain": ["Domain", "Domain", ["/domain"]],
      "/nowhere/at/all": ["Not found", "Sites", []],
      "/Settings": ["Not found", "Sites", []],
    });
  });
});
