// The Sites screen's list: where it stands when another page of it is shown, what a row offers while the trash is read, and what its empty place says.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { emptyWords } from "@/sites/sites-query";
import { SitesScreen } from "@/sites/sites-screen";

import { drawAt } from "../lib/support/router";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** A page of the sites with a page after it, as the server answers it. */
const PAGE = {
  ok: true,
  sites: [
    {
      id: "abc123def456",
      label: "trip-notes--abc123def456",
      name: "trip-notes",
      public_name: null,
      title: "Trip notes",
      title_typed: true,
      access: "private",
      url: "https://example.com/trip-notes/",
      addresses: { site: "https://example.com/trip-notes/", public: null },
      search_engines: false,
      embeddable: false,
      expires: null,
      versions: [{ number: 1, published: 1_700_000_000_000, published_by: "mira@example.com" }],
      live_version: 1,
      bytes: 2048,
      files: 3,
      updated: 1_700_000_000_000,
      state: "live",
      views: { today: 0, week: 0 },
    },
  ],
  next: "trip-notes",
  logins: {},
};

/** Every read of the sites the screen made, as the query it asked. */
const asked: string[] = [];

/** The same page with its site in the trash, which it leaves a week after it was updated. */
const TRASH = { ...PAGE, sites: PAGE.sites.map((site) => ({ ...site, state: "trash", gone_on: site.updated + 604_800_000 })) };

/** Draw the screen at an address, with the sites answered by one page whatever is asked, and wait for the site that page draws. */
async function draw(address: string, page: typeof PAGE = PAGE): Promise<void> {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { pathname, search } = new URL(input instanceof Request ? input.url : input, window.location.href);
    if (pathname !== `${BOOT.base}/data/sites`) return Response.json({ ok: false, code: "refused", about: null, sentence: "Refused." }, { status: 400 });

    asked.push(search);

    return Response.json(page);
  }) as typeof fetch;

  await drawAt(
    address,
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <SitesScreen />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await readAfter(0);
}

/** Wait until the screen has read the sites again after the reads counted, and drawn the site of the answer. */
async function readAfter(reads: number): Promise<void> {
  await waitFor(() => expect(asked.length).toBeGreaterThan(reads));
  await within(document.body).findAllByText("Trip notes");
}

afterEach(() => {
  cleanup();
  globalThis.fetch = OWN_FETCH;
  asked.length = 0;
});
afterAll(clearPage);

describe("the pages of the sites", () => {
  // Drift: Next page is pressed at the foot of a long page, and the next page would open scrolled to its own foot, its first sites out of sight.
  test("a page gone on to is shown from its first site, on a wide screen and on a phone", async () => {
    await draw("/");
    const lists = [document.querySelector('[data-slot="scroll-area-viewport"]'), document.querySelector('ul[aria-label="Sites"]')?.parentElement];
    for (const list of lists) if (list !== null && list !== undefined) list.scrollTop = 300;
    const scrolled = lists.map((list) => list?.scrollTop);

    // The ways under the list are drawn under the table and under a phone's list: either leads the same way.
    fireEvent.click(within(document.body).getAllByRole("button", { name: "Next page" })[0] as HTMLElement);
    await readAfter(1);
    await waitFor(() => expect(lists.map((list) => list?.scrollTop)).toEqual([0, 0]));

    expect(scrolled).toEqual([300, 300]);
  });
});

describe("the button that reads the list again", () => {
  // Drift: the button would read nothing, or read the list for another address than the one shown.
  test("reads the page of sites the address asks for once more", async () => {
    await draw("/?sort=title");
    const before = [...asked];

    fireEvent.click(within(document.body).getByRole("button", { name: "Refresh the list" }));
    await readAfter(1);

    expect([before, asked]).toEqual([["?sort=title&dir=asc"], ["?sort=title&dir=asc", "?sort=title&dir=asc"]]);
  });
});

describe("a row under the trash's filter", () => {
  // Drift: while the trash is read the rows of the list before still show, and each would offer Restore for a site that is not in the trash, which the server refuses.
  test("has no Restore while it shows a site that is not in the trash", async () => {
    await draw("/?view=trash");

    expect(within(document.body).queryAllByRole("button", { name: /^Restore/ }).length).toBe(0);
  });

  // Drift: a phone's row of the trash would say no day again: not when the site was updated, which no longer matters, and not when it is gone for good, which does.
  test("says on a phone the day its site leaves the trash, beside the way back", async () => {
    await draw("/?view=trash", TRASH);
    const row = within(within(document.body).getByRole("list", { name: "Sites" })).getByRole("listitem");

    expect([/Leaves the trash on 2[12] Nov 2023$/.test(row.querySelector("div")?.textContent ?? ""), within(row).getAllByRole("button", { name: "Restore Trip notes" }).length]).toEqual([true, 1]);
  });
});

describe("the buttons after a site's link", () => {
  // Drift: every row would hold buttons of one name again, and a screen reader's list of buttons would not say which site each one is for.
  test("are named with the row's site, in the table and in a phone's list", async () => {
    await draw("/");
    const names = within(document.body)
      .getAllByRole("button", { name: /^(Copy the link|Open the site)/ })
      .map((button) => button.getAttribute("aria-label"));

    expect(names.toSorted()).toEqual(["Copy the link of Trip notes", "Copy the link of Trip notes", "Open the site Trip notes", "Open the site Trip notes"]);
  });
});

describe("a table with no site", () => {
  // Drift: a pasted link that finds no site would be told "Check the spelling" again, with the whole link said back, where a link has no spelling a person checks.
  test.each([
    ["all", "report", 'No sites match "report"', "Check the spelling, or show all sites."],
    ["private", "report", 'No private sites match "report"', "Check the spelling, or show all sites."],
    ["all", "https://report--k3f9x2ab71qz-p-poplin.example.com/", "No site at that link", "Check the link, or show all sites."],
    ["all", " <http://sites.example.net/report--k3f9x2ab71qz/>", "No site at that link", "Check the link, or show all sites."],
    ["public", '"HTTPS://docs-page.example.com"', "No public site at that link", "Check the link, or show all sites."],
    ["trash", "https://docs-page.example.com", "No site in the trash at that link", "Check the link, or show all sites."],
    ["all", "report https://example.com", 'No sites match "report https://example.com"', "Check the spelling, or show all sites."],
  ] as const)("under %s, for the search %j, is titled %s and says %s", (filter, search, title, says) => {
    expect(emptyWords(filter, search)).toEqual({ title, says });
  });
});
