// The button that reads one thing again: what a press reads and what it leaves alone, and what it shows while the read is under way.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { RefreshButton } from "@/shared/icon-button";

import { clearPage } from "../lib/support/page";

/** How often each of the two things of the test page was read. */
const reads = { list: 0, graph: 0 };

/** The reads of the list that wait for the test to answer them. */
const waiting: (() => void)[] = [];

/** A page with two things that are read, and a button for the first alone. */
function TwoThings(): ReactNode {
  const list = useQuery({ queryKey: ["list"], queryFn: () => new Promise<number>((answer) => waiting.push(() => answer(++reads.list))) });
  useQuery({ queryKey: ["graph"], queryFn: () => ++reads.graph });

  return <RefreshButton label="Refresh the list" read={list} />;
}

/** Answer every read of the list that waits. */
async function answer(): Promise<void> {
  await act(async () => {
    for (const read of waiting.splice(0)) read();
  });
}

/** Draw the page and answer its first read of the list. */
async function draw(): Promise<HTMLElement> {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } })}>
      <TooltipProvider>
        <TwoThings />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(waiting.length).toBe(1));
  await answer();

  return within(document.body).getByRole("button", { name: "Refresh the list" });
}

afterEach(() => {
  cleanup();
  waiting.length = 0;
  reads.list = 0;
  reads.graph = 0;
});
afterAll(clearPage);

describe("the button that reads one thing again", () => {
  // Drift: one press would read everything the screen holds again, the heavy read beside it too; or a second press would start a second read while the first is under way.
  test("reads its own thing once at a press, turns while the read is under way, and leaves every other read alone", async () => {
    const button = await draw();

    fireEvent.click(button);
    await waitFor(() => expect(waiting.length).toBe(1));
    await waitFor(() => expect(within(button).queryByRole("status") === null).toBe(false));
    fireEvent.click(button);
    await answer();

    await waitFor(() => expect(within(button).queryByRole("status") === null).toBe(true));

    expect(reads).toEqual({ list: 2, graph: 1 });
  });
});
