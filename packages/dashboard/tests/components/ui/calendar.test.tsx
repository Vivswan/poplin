// The calendar under the keyboard: the arrow keys move the focus from day to day, and the key that presses a button picks the day the focus is on.

import { clearPage } from "../../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { Calendar } from "@/components/ui/calendar";

/** The month the calendar opens on, and the day the focus starts at. */
const [MONTH, START] = [new Date(2026, 11, 1), "2026-12-10"];

/** The day the focus is on, as the calendar names it on its cell, or nothing while no day holds the focus. */
function focusedDay(): string | undefined {
  return document.activeElement?.closest("td")?.getAttribute("data-day") ?? undefined;
}

/** Press a key on what holds the focus. A button takes Enter as a press, as a browser does. */
async function key(name: string): Promise<void> {
  const held = document.activeElement as HTMLElement;
  await act(async () => {
    fireEvent.keyDown(held, { key: name });
    if (name === "Enter") fireEvent.click(held);
  });
}

afterEach(cleanup);
afterAll(clearPage);

describe("the calendar", () => {
  // Drift: the library moves its own focused day on an arrow key, and the day's button takes the focus only through the component's ref. Without it the keys move nothing a person sees, and Enter picks the day the focus started on.
  test("the arrow keys move the focus a day or a week at a time, and Enter picks the day the focus is on", async () => {
    const picked: (string | undefined)[] = [];
    render(<Calendar mode="single" defaultMonth={MONTH} onSelect={(day) => picked.push(day?.toLocaleDateString("en-CA"))} />);
    await act(async () => (document.querySelector(`td[data-day="${START}"] button`) as HTMLElement).focus());
    const seen = [focusedDay()];
    for (const name of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight"]) {
      await key(name);
      await waitFor(() => expect(focusedDay()).not.toBe(seen.at(-1)));
      seen.push(focusedDay());
    }
    await key("Enter");

    expect([seen, picked]).toEqual([["2026-12-10", "2026-12-11", "2026-12-18", "2026-12-17", "2026-12-10", "2026-12-11"], ["2026-12-11"]]);
  });
});
