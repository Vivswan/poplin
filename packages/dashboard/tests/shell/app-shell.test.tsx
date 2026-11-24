// The frame around every screen: what it marks and says at the side, and the way past the sections.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { FRAME_KEY } from "@/lib/frame";
import { AppShell } from "@/shell/app-shell";
import { drawAt } from "../lib/support/router";

/** The key the look is kept under in these tests. */
const THEME_KEY = "test.theme";

/** What the frame holds besides the note on the domain and the marks. */
const FRAME = { ok: true, update: null, starts: false, back: null, recent: [] } as const;

/** A newer release the install knows of, on an install that holds its key. */
const NEWER = { update: { current: BOOT.version, newest: "1.1.0", released: "2026-11-02", notes: "https://example.com/notes", database: false }, starts: true } as const;

/** The marks of an install where nothing went wrong. */
const NO_MARKS = { usage: null, domain: null, settings: null };

/** The mark of a Settings screen that holds one problem. */
const FAILED = { count: 1, says: "An update did not go as it should" };

/** What of the frame a test sets besides the note on the domain. */
type Shown = Partial<typeof NEWER> & { readonly marks?: object };

/** Draw the frame around an empty screen, over a frame that holds the note given, and what else of the frame a test sets. */
async function drawWith(domainNote: { readonly label: string; readonly sentence: string; readonly quiet: boolean } | null, more: Shown = {}): Promise<void> {
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

/** The colour a mark's sign is drawn in, by the class that names it. */
function lookOf(mark: HTMLElement): string | undefined {
  return mark.querySelector("svg")?.getAttribute("class")?.split(" ").find((look) => look.startsWith("text-"));
}

afterEach(() => {
  cleanup();
  mock.restore();
});
afterAll(clearPage);

describe("the way out of the login", () => {
  // Drift: the console sends a browser on from one path of its own to where the provider ends a login. A link to any other place, or one the router answers with a screen, would leave the browser logged in.
  test("is named Sign out, the one item of the menu the email at the foot of the side opens, and leads to the console's own way out", async () => {
    await drawWith(null);
    const account = screen.getByTitle(BOOT.email);
    const before = screen.queryAllByText("Sign out").length;
    await act(async () => {
      fireEvent.click(account);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const items = screen.getAllByRole("menuitem");

    expect([before, items.map((item) => [item.textContent, item.getAttribute("href")]), account.getAttribute("aria-expanded")]).toEqual([0, [["Sign out", `${BOOT.base}/out`]], "true"]);
  });

  // Drift: the menu would open beside the email again, over the working area, where it covers what the screen shows.
  test("opens over the email, from the email's left edge", async () => {
    await drawWith(null);
    await act(async () => {
      fireEvent.click(screen.getByTitle(BOOT.email));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const menu = screen.getByRole("menu");

    expect([menu.getAttribute("data-side"), menu.getAttribute("data-align")]).toEqual(["top", "start"]);
  });
});

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

  // Drift: the start of an update stands on Settings alone, so a newer release would show on no other screen; or it would be counted as a problem, and drawn as the alarm one is.
  test.each([
    { name: "at Settings, as no problem, and its link leads to the row of the version", more: NEWER, marked: [["/settings#setting-version", "update available", "text-link"]] },
    { name: "at no section while the Settings screen holds a problem, whose mark stands there", more: { ...NEWER, marks: { ...NO_MARKS, settings: FAILED } }, marked: [["/settings", "1 problem", "text-destructive"]] },
  ] as const)("names a newer release $name", async ({ more, marked }) => {
    await drawWith(null, more);
    const signs = screen.getAllByRole("img").map((mark) => [mark.closest("a")?.getAttribute("href")?.slice(BOOT.base.length), mark.getAttribute("aria-label"), lookOf(mark)]);

    expect(signs).toEqual(marked.map((mark) => [...mark]));
  });

  // Drift: on a phone the sections are behind a button, so a problem or a newer release would show nowhere until a person happened to open them.
  test.each([
    { name: "no section holds a problem", more: {}, button: "Sections" },
    { name: "two sections hold three", more: { marks: { usage: { count: 2, says: "A request failed" }, domain: { count: 1, says: "The login could not be checked" }, settings: null } }, button: "Sections, 3 problems" },
    { name: "a newer release is out and no section holds a problem", more: NEWER, button: "Sections, update available" },
    { name: "a newer release is out and a section holds a problem", more: { ...NEWER, marks: { ...NO_MARKS, settings: FAILED } }, button: "Sections, 1 problem" },
  ] as const)("the button that opens the sections on a phone is named for all of them: $name", async ({ more, button }) => {
    await drawWith(null, more);

    expect(screen.getAllByRole("button", { name: /^Sections/, hidden: true }).map((named) => named.getAttribute("aria-label"))).toEqual([button]);
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

describe("the screen's title", () => {
  // Drift: every screen's tab would be named "poplin" alone again, so a list of tabs or a screen reader's first words would not tell one screen from another.
  test("starts the page's own title, before the product's name", async () => {
    await drawWith(null);

    expect(document.title).toBe("Sites - poplin");
  });

  // Drift: the first stop of the Tab key would be the first of the sections again, with a dozen stops before the screen; or the way past them would lead nowhere.
  test("takes the focus from the way past the sections, which is the first button of the page", async () => {
    await drawWith(null);
    const skip = screen.getAllByRole("button")[0] as HTMLElement;
    fireEvent.click(skip);

    expect([skip.textContent, document.activeElement?.tagName, document.activeElement?.textContent]).toEqual(["Skip to the content", "H1", "Sites"]);
  });
});
