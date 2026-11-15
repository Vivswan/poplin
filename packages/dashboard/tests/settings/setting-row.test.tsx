// The row of a setting: its name, one sentence with the default after it, and its control; the way back to the default while the value differs; the same words behind the "?" a narrow column shows; and the host's warnings behind the mark after the control.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

import { SettingRow } from "@/settings/setting-row";
import type { Row } from "@/settings/settings-queries";

/** The two sentences the host warns with in these tests. */
const WARNINGS = ["The host bills storage past 10 GB.", "A second limit is passed too."];

/** A size at its default, with no warning. */
const SIZE: Row = {
  key: "max_total_size",
  control: { kind: "number", word: null },
  text: "9000MB",
  unit: "MB",
  fallback: "9000MB",
  warnings: [],
  repair: false,
};

/** Draw the row over a text, and collect every text it sends. */
function drawn(row: Row, text = row.text): { readonly page: ReturnType<typeof within>; readonly sent: string[] } {
  const sent: string[] = [];
  render(<SettingRow row={row} text={text} refusal={undefined} onChange={(next) => sent.push(next)} marked={false} />);

  return { page: within(document.body), sent };
}

afterEach(cleanup);
afterAll(clearPage);

/** The paragraphs of the popover that is open, found by the name a screen reader reads it under. */
function opened(name: string): (string | null)[] {
  return [...within(document.body).getByRole("dialog", { name }).querySelectorAll("p")].map((line) => line.textContent);
}

describe("the row of a setting", () => {
  // Drift: a Reset, a warning's mark, or the setting's key would stand in the row of a setting that is at its default, or the default would go unsaid.
  test("shows at rest its name, its one sentence with the default in brackets, its control, and its unit", () => {
    drawn(SIZE);

    expect(document.body.textContent).toBe("All sites togetherThe most all sites hold, the trash included. (Default: 9,000 MB)MB");
  });

  // Drift: a changed value would have no way back, or Reset would put back something other than the default.
  test("offers Reset beside the default of a value that differs from it, which puts the default back", () => {
    const { page, sent } = drawn(SIZE, "12000MB");
    const line = page.getByText(/Default:/).textContent;
    fireEvent.click(page.getByRole("button", { name: "Reset" }));

    expect([line, sent]).toEqual(["The most all sites hold, the trash included. (Default: 9,000 MB) Reset", ["9000MB"]]);
  });

  // Drift: a narrow column, which hides the sentence beside the name, would have no way to read it or the default, or no way back to the default.
  test("holds the sentence, the default, and the Reset of a changed value behind the question mark too", () => {
    const { page, sent } = drawn(SIZE, "12000MB");
    fireEvent.click(page.getByRole("button", { name: "About All sites together" }));
    const lines = opened("All sites together");
    fireEvent.click(within(page.getByRole("dialog", { name: "All sites together" })).getByRole("button", { name: "Reset" }));

    expect([lines, sent]).toEqual([["The most all sites hold, the trash included.", "Default: 9,000 MBReset"], ["9000MB"]]);
  });

  // Drift: a warning would have no mark after the control, or two warnings would run together as one paragraph.
  test("holds the host's warnings behind the mark after the control, each sentence a line of its own", () => {
    const { page } = drawn({ ...SIZE, warnings: WARNINGS });
    fireEvent.click(page.getByRole("button", { name: "Warning" }));

    expect(opened("Warning")).toEqual(WARNINGS);
  });
});
