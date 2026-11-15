// The Activity screen's order: what a press on the When heading asks of the server, and what the pager sends after it.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

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
  next: "12",
};

/** Every read of the log the screen made, as the query it asked. */
const asked: string[] = [];

/** Draw the screen at an address, with the log answered by one page whatever is asked. */
async function draw(address: string): Promise<void> {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { pathname, search } = new URL(input instanceof Request ? input.url : input, window.location.href);
    if (pathname !== `${BOOT.base}/data/activity`) return Response.json({ ok: false, code: "refused", about: null, sentence: "Refused." }, { status: 400 });

    asked.push(search);

    return Response.json(PAGE);
  }) as typeof fetch;

  await drawAt(
    address,
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider storageKey="test.theme">
        <TooltipProvider>
          <ActivityScreen />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  await readAfter(0);
}

/** Press a button of the page by its name, and let the screen read what the press asks for. */
async function press(name: string): Promise<void> {
  const before = asked.length;
  // The ways under the list are drawn under the table and under a phone's list: either leads the same way.
  fireEvent.click(within(document.body).getAllByRole("button", { name })[0] as HTMLElement);
  await readAfter(before);
}

/** Wait until the screen has read the log again after the reads counted, and drawn the rows of the answer. */
async function readAfter(reads: number): Promise<void> {
  await waitFor(() => expect(asked.length).toBeGreaterThan(reads));
  await within(document.body).findAllByText("mira@example.com");
}

function whenOrder(): string | null {
  return within(document.body).getByRole("columnheader", { name: "When" }).getAttribute("aria-sort");
}

afterEach(() => {
  cleanup();
  globalThis.fetch = OWN_FETCH;
  window.localStorage.clear();
  asked.length = 0;
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
