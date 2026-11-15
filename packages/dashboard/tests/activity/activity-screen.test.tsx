// The Activity screen's order and pages: what a press on the When heading asks of the server, what the foot sends after it, and how often the total is read.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ActivityScreen } from "@/activity/activity-screen";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";

import { drawAt } from "../lib/support/router";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** A page of the log with a page after it, as the server answers it. */
const PAGE = {
  ok: true,
  entries: [{ seq: 12, at: 1_700_000_000_000, by: "mira@example.com", action: "login", detail: {}, site: null }],
  logins: {},
  of: null,
  next: "12",
  previous: null,
  stopped: false,
};

/** A page with one entry about a site, under the id the entry holds. */
const SITE_PAGE = { ...PAGE, entries: [{ ...PAGE.entries[0], action: "create", site: { id: "abcdefghijkl", name: "field-notes", label: "field-notes-abcdefghijkl", title: "Field notes" } }] };

/** A narrowed page that found no entry among those it looked at, and stopped with the log going on behind place 9. */
const STOPPED_PAGE = { ...PAGE, entries: [], next: "9", stopped: true };

/** What the log answers a read with; a test swaps the page, and it is put back after each. */
const answered = { page: PAGE as typeof PAGE | typeof STOPPED_PAGE | typeof SITE_PAGE };

/** How many entries the log holds, as the server answers it. */
const TOTAL = { ok: true, total: 1240, whole: true };

/** Every read of the log the screen made, as the query it asked. */
const asked: string[] = [];

/** Every read of the total the screen made, as the query it asked. */
const counted: string[] = [];

/** A cache of what the screen read, as the dashboard keeps one while it is open. */
function cacheOf(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Draw the screen at an address, with the log answered by one page whatever is asked, and wait for the words that page draws. */
async function draw(address: string, cache = cacheOf(), shown = "mira@example.com"): Promise<void> {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { pathname, search } = new URL(input instanceof Request ? input.url : input, window.location.href);
    if (pathname === `${BOOT.base}/data/activity/total`) {
      counted.push(search);

      return Response.json(TOTAL);
    }

    if (pathname !== `${BOOT.base}/data/activity`) return Response.json({ ok: false, code: "refused", about: null, sentence: "Refused." }, { status: 400 });

    asked.push(search);

    return Response.json(answered.page);
  }) as typeof fetch;

  await drawAt(
    address,
    <QueryClientProvider client={cache}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <ActivityScreen />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await readAfter(0, shown);
}

/** Press a button of the page by its name, and let the screen read what the press asks for. */
async function press(name: string): Promise<void> {
  const before = asked.length;
  // The ways under the list are drawn under the table and under a phone's list: either leads the same way.
  fireEvent.click(within(document.body).getAllByRole("button", { name })[0] as HTMLElement);
  await readAfter(before);
}

/** Wait until the screen has read the log again after the reads counted, and drawn the rows of the answer. */
async function readAfter(reads: number, shown = "mira@example.com"): Promise<void> {
  await waitFor(() => expect(asked.length).toBeGreaterThan(reads));
  await within(document.body).findAllByText(shown);
}

function whenOrder(): string | null {
  return within(document.body).getByRole("columnheader", { name: "When" }).getAttribute("aria-sort");
}

afterEach(() => {
  cleanup();
  globalThis.fetch = OWN_FETCH;
  window.localStorage.clear();
  asked.length = 0;
  counted.length = 0;
  answered.page = PAGE;
});
afterAll(clearPage);

describe("the order of the log", () => {
  // Drift: a turned log would go on from a place of the order before and skip every entry between, or a third press would leave the log in no order the server knows.
  test("When pressed asks the server for the oldest first and drops the cursor, and pressed again for the newest first", async () => {
    await draw("/activity?kind=access&after=40");
    const first = [...asked, whenOrder()];

    await press("When");
    const turned = [window.location.search, asked.at(-1), whenOrder()];

    await press("Next page");
    const next = [window.location.search, asked.at(-1)];

    await press("When");
    const back = [window.location.search, asked.at(-1), whenOrder()];

    expect({ first, turned, next, back }).toEqual({
      first: ["?kind=access&after=40", "descending"],
      turned: ["?kind=access&sort=when&dir=asc", "?kind=access&dir=asc", "ascending"],
      next: ["?kind=access&sort=when&dir=asc&after=12&from=2", "?kind=access&dir=asc&after=12"],
      back: ["?kind=access", "?kind=access", "descending"],
    });
  });

  // Drift: only When is an order the server has, so a press on another heading would ask for one it refuses.
  test("no other heading can be pressed for an order", async () => {
    await draw("/activity");
    const orders = within(document.body)
      .getAllByRole("columnheader")
      .map((heading) => [heading.textContent?.trim(), heading.getAttribute("aria-sort")]);

    expect(orders).toEqual([
      ["When", "descending"],
      ["Who", null],
      ["What", null],
      ["Site", null],
      ["Actions", null],
    ]);
  });
});

describe("the log of one site", () => {
  // Drift: the row's filter would search for the name the site had then, which finds other sites and misses a renamed one, or keep a text beside the id, which the server refuses.
  test("Only this site asks for the entries of the id the row holds and drops the text; the mark names the site, and its button shows every site again", async () => {
    answered.page = SITE_PAGE;
    await draw("/activity?kind=sites&site=notes&after=40");

    await press("Only this site");
    const only = [window.location.search, asked.at(-1), within(document.body).getByText("Only Field notes").textContent, within(document.body).queryAllByRole("button", { name: "Only this site" }).length];

    await press("Show every site");
    const every = [window.location.search, asked.at(-1), within(document.body).queryAllByText("Only Field notes").length];

    expect({ only, every }).toEqual({
      only: ["?kind=sites&of=abcdefghijkl", "?kind=sites&of=abcdefghijkl", "Only Field notes", 0],
      every: ["?kind=sites", "?kind=sites", 0],
    });
  });

  // Drift: a text and an id would be sent together, from an address that holds both or from a text typed over a log of one site, and the server refuses the two together.
  test("a text takes the place of the id: in an address that holds both, and typed into the search", async () => {
    await draw("/activity?of=abcdefghijkl&site=notes");
    const both = asked.at(-1);
    cleanup();

    await draw("/activity?of=abcdefghijkl");
    const before = asked.length;
    fireEvent.change(within(document.body).getByRole("searchbox"), { target: { value: "trip" } });
    await readAfter(before);

    expect([both, window.location.search, asked.at(-1)]).toEqual(["?site=notes", "?site=trip", "?site=trip"]);
  });
});

describe("the pages of the log", () => {
  // Drift: Next page is pressed at the foot of a long page, and the next page would open scrolled to its own foot, its first entries out of sight.
  test("a page gone on to is shown from its first entry, on a wide screen and on a phone", async () => {
    await draw("/activity");
    const lists = [document.querySelector('[data-slot="scroll-area-viewport"]'), document.querySelector('ul[aria-label="Activity"]')?.parentElement];
    for (const list of lists) if (list !== null && list !== undefined) list.scrollTop = 300;
    const scrolled = lists.map((list) => list?.scrollTop);

    await press("Next page");
    await waitFor(() => expect(lists.map((list) => list?.scrollTop)).toEqual([0, 0]));

    expect(scrolled).toEqual([300, 300]);
  });

  // Drift: every turn of a page would count the log again, at up to 10,000 rows a count, or a narrowed log would show the total of the whole one.
  test("the total is read once for a narrowing, not again at a page's turn or in another order, and again once the screen was closed", async () => {
    const cache = cacheOf();
    await draw("/activity?kind=access", cache);
    const foot = await within(document.body).findAllByText("1 to 1 of 1,240");
    await press("Next page");
    await press("When");
    const open = [window.location.search, [...counted]];

    cleanup();
    await draw("/activity?kind=access", cache);
    await within(document.body).findAllByText("1 to 1 of 1,240");

    expect([foot.length > 0, open, counted]).toEqual([true, ["?kind=access&sort=when&dir=asc", ["?kind=access"]], ["?kind=access", "?kind=access"]]);
  });

  // Drift: a search for a rare site whose newest entry lies deep in the log would read "No activity" as if the log held none, with Download shut and no way to look further.
  test("a narrowed page with no entry that stopped looking keeps Download open and offers Search further under its words, which goes on from where it stopped", async () => {
    answered.page = STOPPED_PAGE;
    await draw("/activity?site=o", cacheOf(), 'No activity for "o"');
    const download = within(document.body).getByRole("button", { name: "Download" }) as HTMLButtonElement;
    const words = within(document.body).queryAllByText("Searched the newest 5,000 entries.");
    const before = asked.length;
    fireEvent.click(within(document.body).getAllByRole("button", { name: "Search further" })[0] as HTMLElement);
    await readAfter(before, 'No activity for "o"');

    expect([download.disabled, words.length, asked.at(-1), window.location.search]).toEqual([false, 1, "?site=o&after=9", "?site=o&after=9&from=1"]);
  });

  // Drift: a size would be kept and never asked of the server, or a page of the new size would be read from a place among pages of the old one.
  test("a page's size is kept in the browser, asked of the server, and a new one starts at the first page", async () => {
    window.localStorage.setItem("poplin.activity.page-size", JSON.stringify("100"));
    await draw("/activity?after=40&from=41");
    const kept = asked.at(-1);
    const select = within(document.body).getAllByRole("combobox", { name: "Entries per page" })[0] as HTMLElement;
    await act(async () => fireEvent.click(select));
    const before = asked.length;
    await act(async () => fireEvent.keyDown((await within(document.body).findAllByRole("option"))[2] as HTMLElement, { key: "Enter" }));
    await readAfter(before);

    expect([kept, window.location.search, asked.at(-1), window.localStorage.getItem("poplin.activity.page-size")]).toEqual(["?after=40&size=100", "", "?size=200", '"200"']);
  });
});
