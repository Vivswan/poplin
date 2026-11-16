// One press at a time: a second press that comes before the page is drawn again starts nothing.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import { useOnePress } from "@/dialog/one-press";

/** A button over a piece of work, drawn as off while a run is on its way. */
function Pressed({ work }: { readonly work: () => Promise<void> }): ReactNode {
  const { press, busy } = useOnePress(work);

  return (
    <button type="button" disabled={busy} onClick={press}>
      Send
    </button>
  );
}

afterEach(cleanup);
afterAll(clearPage);

describe("a button that takes one press at a time", () => {
  // Drift: a button that is only drawn as off still takes the second press of a double click, which comes before the draw: the change would be sent twice, and the line a person reads would be the second one's refusal.
  test("starts its work once for two presses in a row, is off meanwhile, and takes the next press once the work has ended", async () => {
    const runs: ReturnType<typeof Promise.withResolvers<void>>[] = [];
    const work = (): Promise<void> => {
      const run = Promise.withResolvers<void>();
      runs.push(run);

      return run.promise;
    };
    render(<Pressed work={work} />);
    const button = screen.getByRole("button") as HTMLButtonElement;

    // Two presses with no draw between them, as a double click sends them.
    act(() => {
      button.click();
      button.click();
    });
    const during = [runs.length, button.disabled];
    await act(async () => runs[0]?.resolve());
    act(() => button.click());

    expect([during, runs.length]).toEqual([[1, true], 2]);
  });
});
