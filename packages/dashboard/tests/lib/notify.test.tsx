// A line that says a done change with a button: what the keys reach first, what the line says of the way to it, and what a press does.

import { clearPage } from "./support/page";

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { sayDone } from "@/lib/notify";

/** How long a line may take to leave after its button, in milliseconds: the library takes it away a moment after it is dismissed. */
const LEAVES_WITHIN_MS = 3000;

/** Draw the place of the lines and say one with a button; the list notes each press that reached the button's step. */
async function said(): Promise<string[]> {
  const ran: string[] = [];
  render(
    <ThemeProvider storageKey="test.theme">
      <TooltipProvider>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>,
  );
  await act(async () => sayDone("Moved to the trash.", { run: () => ran.push("ran") }));
  await waitFor(() => expect(within(document.body).queryAllByText("Moved to the trash.").length).toBe(1));

  return ran;
}

/** The names of the line's buttons, in the order the keys reach them. */
function buttons(): (string | null)[] {
  return within(document.body)
    .queryAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

/** Press a button of the line and wait until the line has left. */
async function pressAndLeave(name: string): Promise<void> {
  await act(async () => fireEvent.click(within(document.body).getByRole("button", { name })));
  await waitFor(() => expect(within(document.body).queryAllByText("Moved to the trash.").length).toBe(0), { timeout: LEAVES_WITHIN_MS });
}

afterEach(async () => {
  await act(async () => void toast.dismiss());
  cleanup();
  clearPage();
});

describe("a line with a button", () => {
  // Drift: Close would come before the line's own step again, so the keys reach Undo last; or the line would not say which keys lead to it, which only the name of the lines' region did.
  test("the keys reach its step before Close, and the line names the keys that lead to it and the step", async () => {
    await said();
    expect(buttons()).toEqual(["Undo", "Close"]);
    expect(within(document.body).queryAllByText("Press Alt+T to reach Undo.").length).toBe(1);
  });

  // Drift: the line would stay after its step was done, or Close would do the step.
  test(
    "its step runs once and the line leaves; Close takes the line away and runs nothing",
    async () => {
      const ran = await said();
      await pressAndLeave("Undo");
      expect(ran).toEqual(["ran"]);
      cleanup();

      const closed = await said();
      await pressAndLeave("Close");
      expect(closed).toEqual([]);
    },
    LEAVES_WITHIN_MS * 3,
  );
});
