// The button that reads one thing again: what a press reads and what it leaves alone, and what it shows while the read is under way.
// And the icon button that is the trigger of a menu: one button that is all of what it is drawn from.

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { PencilIcon } from "lucide-react";
import { createRef, type ReactNode } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IconButton, RefreshButton } from "@/shared/icon-button";

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

describe("an icon button that opens a menu", () => {
  // Drift: the hint, the button, and the menu's trigger are three parts of the library drawn as one element, each handing on what the others gave it.
  // One that stopped would leave a button with no name, one that opens nothing, or one that whoever opened something from the menu cannot give the focus back to.
  test("is one button: it has its label as its name, opens its menu at a press and says so, and is what a ref on the trigger holds", async () => {
    const held = createRef<HTMLButtonElement>();
    render(
      <TooltipProvider>
        <DropdownMenu>
          <IconButton label="Change when it expires" opens={<DropdownMenuTrigger ref={held} />}>
            <PencilIcon />
          </IconButton>
          <DropdownMenuContent>
            <DropdownMenuItem>Never</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>,
    );
    const button = within(document.body).getByRole("button", { name: "Change when it expires" });
    const before = [button.getAttribute("aria-haspopup"), button.getAttribute("aria-expanded"), held.current === button, button.textContent];

    await act(async () => fireEvent.click(button));
    await waitFor(() => expect(within(document.body).queryAllByRole("menuitem", { name: "Never" }).length).toBe(1));

    expect([before, button.getAttribute("aria-expanded")]).toEqual([["menu", "false", true, ""], "true"]);
  });
});
