// The Problems block of the Usage screen and the panel beside it: what the list shows, what an empty list says, and what a press on a row opens.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { BOOT } from "@/lib/boot";
import { ProblemsBlock } from "@/problems/problems-block";
import { ProblemsPlace } from "@/problems/problems-place";
import type { Problem } from "@/problems/problems-queries";
import { drawAt } from "../lib/support/router";

/** The runtime's own `fetch` and clipboard, put back after each test. */
const OWN = { fetch: globalThis.fetch, clipboard: navigator.clipboard };

/** What every problem of the tests shares. */
const SHARED = { day: "2026-11-15", more: false, name: null, message: null, first_at: Date.UTC(2026, 10, 15, 13, 32), last_at: Date.UTC(2026, 10, 15, 14, 2) } as const;

/** Three problems as the server answers them: one acted on here, one on the Domain screen, and a limit with its setting. */
const PROBLEMS: readonly Problem[] = [
  { ...SHARED, kind: "request_failed", count: 12, more: true, name: "TypeError", message: "the store did not answer", sentence: "A request failed", todo: "Try again.", home: "usage", setting: null },
  { ...SHARED, kind: "login_unchecked", count: 1, sentence: "The login could not be checked", todo: "Open Domain and press Check.", home: "domain", setting: null },
  { ...SHARED, kind: "requests_limit_reached", count: 1, sentence: "The daily limit of requests was reached", todo: "It works again after midnight UTC.", home: "usage", setting: "requests_per_day" },
];

/** Every stretch of days the block asked the server for. */
const asked: string[] = [];

/** Draw the block inside its place at an address of the Usage screen, with the list answered as given. */
async function draw(address: string, problems: readonly Problem[] = PROBLEMS): Promise<Awaited<ReturnType<typeof drawAt>>> {
  globalThis.fetch = (async (input: Request | string | URL) => {
    const { searchParams } = new URL(input instanceof Request ? input.url : input, window.location.href);
    asked.push(searchParams.get("days") ?? "");

    return Response.json({ ok: true, days: Number(searchParams.get("days")), problems });
  }) as typeof fetch;

  const router = await drawAt(
    address,
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <ProblemsPlace>
          <ProblemsBlock />
        </ProblemsPlace>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  // A count is waited for, never an element: a failed wait for an element writes out the whole page.
  await waitFor(() => expect(screen.queryAllByText(/^No problems in |^A request failed$|^This problem is not in the list any more\.$/).length > 0).toBe(true));

  return router;
}

/** The words of the table's rows, a row each. */
function rows(): string[][] {
  return within(screen.getByRole("table", { name: "Problems" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent ?? ""));
}

afterEach(() => {
  cleanup();
  asked.length = 0;
  globalThis.fetch = OWN.fetch;
  Object.defineProperty(navigator, "clipboard", { value: OWN.clipboard, configurable: true });
});
afterAll(clearPage);

describe("the Problems block", () => {
  // Drift: a row would lose how often it came or where it is acted on, a problem of this screen would send a person to itself, or a limit would have no way to its setting.
  test("lists each problem with when it was last seen and how often, links one acted on elsewhere to its screen, and a limit to its setting", async () => {
    await draw("/usage");
    const table = screen.getByRole("table", { name: "Problems" });

    expect(rows().map((cells) => [cells[0], cells[2], cells[3]])).toEqual([
      ["A request failed", "12+ times", ""],
      ["The login could not be checked", "once", "Domain"],
      ["The daily limit of requests was reached", "once", ""],
    ]);
    expect(within(table).getByRole("link", { name: "Domain" }).getAttribute("href")).toBe(`${BOOT.base}/domain`);
    expect(within(table).getAllByRole("button", { name: "Change this limit" }).map((link) => link.getAttribute("href"))).toEqual([`${BOOT.base}/settings#setting-requests_per_day`]);
    expect(asked).toEqual(["7"]);
  });

  // Drift: the line of an install where nothing went wrong is the owner's own sentence; an empty table in its place would read as a list that did not load.
  test("says there are none, in the owner's words, where nothing went wrong", async () => {
    await draw("/usage", []);

    expect([screen.queryAllByText("No problems in the last 7 days.").length, screen.queryByRole("table", { name: "Problems" })]).toEqual([1, null]);
  });
});

describe("the panel of a problem", () => {
  // Drift: a press on a row would open nothing, the address would not hold the open problem, so a reload or a link would lose it, or the panel would miss what to do.
  test("opens at a press on a row, is held by the address, and says when it came, how often, and what to do", async () => {
    const router = await draw("/usage");
    fireEvent.click(within(screen.getByRole("table", { name: "Problems" })).getByText("A request failed"));
    await waitFor(() => expect(screen.queryAllByRole("complementary", { name: "A request failed" }).length).toBe(1));
    const panel = screen.getByRole("complementary", { name: "A request failed" });

    expect(router.state.location.search).toEqual({ problem: "2026-11-15.request_failed" });
    expect(within(panel).getByText(/^First 15 Nov 2026, .* 12\+ times\.$/) !== null).toBe(true);
    expect(within(panel).getByText("Try again.") !== null).toBe(true);
  });

  // Drift: the details would hold something else than the problem shown, or the button would copy nothing.
  test("copies the details of the problem it shows", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void copied.push(text) }, configurable: true });
    await draw("/usage?problem=2026-11-15.request_failed");
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Copy the details" }).length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Copy the details" }));

    await waitFor(() => expect(copied.length).toBe(1));
    expect(copied[0]?.split("\n").slice(0, 2).concat(copied[0]?.split("\n").at(-1) ?? "")).toEqual(["poplin 1.0.0: request_failed", "A request failed", "Failure: TypeError: the store did not answer"]);
  });

  // Drift: a link to a problem that has left the list would show a panel that waits for ever.
  test("says so when the address names a problem that is not in the list", async () => {
    await draw("/usage?problem=2026-01-01.request_failed");

    expect(screen.queryAllByText("This problem is not in the list any more.").length).toBe(1);
  });

  // Drift: Close would lead away from the screen, or drop the chosen stretch of days.
  test("closes back to the list, the chosen days kept", async () => {
    const router = await draw("/usage?days=30&problem=2026-11-15.request_failed");
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Close: back to usage" }).length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Close: back to usage" }));

    await waitFor(() => expect(router.state.location.search).toEqual({ days: "30" }));
    expect(screen.queryByRole("complementary", { name: "A request failed" })).toBeNull();
  });
});
