// The frame around every screen: what it marks and says at the side, and the switch of the look at the top.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { FRAME_KEY } from "@/lib/frame";
import { AppShell } from "@/shell/app-shell";
import { drawAt } from "../lib/support/router";

/** The key the look is kept under in these tests. */
const THEME_KEY = "test.theme";

/** What the frame holds besides the note on the domain and the marks. */
const FRAME = { ok: true, update: null, starts: false, recent: [] } as const;

/** A newer release the install knows of, with an update link saved. */
const NEWER = { update: { current: BOOT.version, newest: "1.1.0", released: "2026-11-02", notes: "https://example.com/notes", database: false }, starts: true } as const;

/** The marks of an install where nothing went wrong. */
const NO_MARKS = { usage: null, domain: null, settings: null };

/** Draw the frame around an empty screen, over a frame that holds the note given, and what else of the frame a test sets. */
async function drawWith(domainNote: { readonly label: string; readonly sentence: string; readonly quiet: boolean } | null, more: Partial<typeof NEWER> & { readonly marks?: object } = {}): Promise<void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(FRAME_KEY, { ...FRAME, marks: NO_MARKS, ...more, domainNote });

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

describe("the mark at a section of the side", () => {
  // Drift: a problem would show only on its own screen, the mark would be a colour with no name for a screen reader, or a section with nothing wrong would carry one.
  test("names how many problems the section's screen holds, on the section's link, and stands at no section without one", async () => {
    await drawWith(null, { marks: { usage: { count: 2, says: "A request failed" }, domain: { count: 1, says: "The login could not be checked" }, settings: null } });
    const marked = screen.getAllByRole("img").map((mark) => [mark.closest("a")?.getAttribute("href"), mark.getAttribute("aria-label")]);

    expect(marked).toEqual([
      [`${BOOT.base}/usage`, "2 problems"],
      [`${BOOT.base}/domain`, "1 problem"],
    ]);
    expect(screen.getByRole("link", { name: "Usage 2 problems" }) !== null).toBe(true);
  });

  // Drift: on a phone the sections are behind a button, so a problem would show nowhere until a person happened to open them.
  test.each([
    ["no section holds a problem", { usage: null, domain: null, settings: null }, "Sections"],
    ["two sections hold three", { usage: { count: 2, says: "A request failed" }, domain: { count: 1, says: "The login could not be checked" }, settings: null }, "Sections, 3 problems"],
  ] as const)("the button that opens the sections on a phone is named %s", async (_what, marks, name) => {
    await drawWith(null, { marks });

    expect(screen.getAllByRole("button", { name: /^Sections/, hidden: true }).map((button) => button.getAttribute("aria-label"))).toEqual([name]);
  });
});

describe("the note on the domain at the side", () => {
  // Drift: an old check would be drawn as an alarm, or the reminder would lead nowhere.
  test("is a quiet word that leads to the Domain screen while the last check is only old", async () => {
    const note = { label: "Domain check is old", sentence: "The last check of the domain is over 30 days old.", quiet: true };
    await drawWith(note);
    const link = screen.getByRole("link", { name: note.label });

    expect([link.getAttribute("href"), link.querySelector("svg"), link.className.includes("text-destructive")]).toEqual([`${BOOT.base}/domain`, null, false]);
  });

  // Drift: a domain with nothing to do would still carry a line at the side.
  test("is not drawn when the install has nothing to say of its domain", async () => {
    await drawWith(null);

    expect(screen.queryByRole("link", { name: /^Domain ./ })).toBeNull();
  });
});

describe("the sections of a phone", () => {
  // Drift: a phone would say only the version it runs again, with the newer one, its notes and the start of the update on a wide screen alone.
  test("say that a newer version is out, link its notes, and start the update with a question, behind which they close", async () => {
    await drawWith(null, NEWER);
    fireEvent.click(screen.getByRole("button", { name: "Sections" }));
    const sections = await screen.findByRole("dialog");
    const notes = within(sections).getByRole("link", { name: "What changed" });
    const said = [within(sections).getByText(`Running poplin ${BOOT.version}`).tagName, notes.parentElement?.textContent, notes.getAttribute("href")];

    fireEvent.click(within(sections).getByRole("button", { name: "Update now" }));
    const asked = await screen.findByRole("alertdialog", { name: "Update to 1.1.0?" });
    await waitFor(() => expect(screen.queryAllByRole("dialog").length).toBe(0));

    expect([said, asked.tagName]).toEqual([["P", "1.1.0 is out. What changed", "https://example.com/notes"], "DIV"]);
  });

  // Drift: an install with nothing newer would offer an update on a phone.
  test("say the version alone while nothing newer is known", async () => {
    await drawWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Sections" }));
    const sections = await screen.findByRole("dialog");

    expect([within(sections).getByText(`Running poplin ${BOOT.version}`).tagName, within(sections).queryByRole("button", { name: "Update now" }), within(sections).queryByText(/is out/)]).toEqual([
      "P",
      null,
      null,
    ]);
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
