// The frame around every screen: what it says of the domain at the side, and the switch of the look at the top.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { FRAME_KEY } from "@/lib/frame";
import { AppShell } from "@/shell/app-shell";
import { drawAt } from "../lib/support/router";

/** The key the look is kept under in these tests. */
const THEME_KEY = "test.theme";

/** What the frame holds besides the note on the domain. */
const FRAME = { ok: true, update: null, starts: false } as const;

/** Draw the frame around an empty screen, over a frame that holds the note given. */
async function drawWith(domainNote: { readonly label: string; readonly sentence: string; readonly quiet: boolean } | null): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(FRAME_KEY, { ...FRAME, domainNote });

  await drawAt(
    "/",
    <QueryClientProvider client={client}>
      <ThemeProvider storageKey={THEME_KEY}>
        <TooltipProvider>
          <AppShell current="sites" heading="Sites">
            <p>The screen.</p>
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
afterAll(clearPage);

describe("the note on the domain at the side", () => {
  // Drift: a domain that needs a repair would show only on its own screen, an old check would be drawn as an alarm, or the note would lead nowhere.
  test.each([
    ["an alarm", { label: "Domain needs fixing", sentence: "A piece of the domain is missing or changed.", quiet: false }, true],
    ["a quiet word", { label: "Domain check is old", sentence: "The last check of the domain is over 30 days old.", quiet: true }, false],
  ] as const)("is %s that leads to the Domain screen", async (_what, note, alarm) => {
    await drawWith(note);
    const link = screen.getByRole("link", { name: note.label });

    expect([link.getAttribute("href"), link.querySelector("svg") !== null, link.className.includes("text-destructive")]).toEqual([
      `${BOOT.base}/domain`,
      alarm,
      alarm,
    ]);
  });

  // Drift: a domain with nothing to do would still carry a line at the side.
  test("is not drawn when the install has nothing to say of its domain", async () => {
    await drawWith(null);

    expect(screen.queryByRole("link", { name: /^Domain ./ })).toBeNull();
  });
});

describe("the switch of the look at the top", () => {
  // Drift: the look would be chosen only in a menu again, a press would not change it, or the button would name the look it already shows.
  test("turns the page dark on a press and then offers the way back, kept in the browser", async () => {
    await drawWith(null);
    const before = document.documentElement.classList.contains("dark");
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark" }));

    expect([before, document.documentElement.classList.contains("dark"), localStorage.getItem(THEME_KEY), screen.getByRole("button", { name: "Switch to light" }) !== null]).toEqual([
      false,
      true,
      "dark",
      true,
    ]);
  });
});
