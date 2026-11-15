// The block of a setting: its name, one sentence, and its control at rest, and under the control only what is needed: the default with the way back to it while the value differs, and the host's warnings, each on a line.

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

/** Draw the block over a text, and collect every text it sends. */
function drawn(row: Row, text = row.text): { readonly page: ReturnType<typeof within>; readonly sent: string[] } {
  const sent: string[] = [];
  render(<SettingRow row={row} text={text} refusal={undefined} onChange={(next) => sent.push(next)} marked={false} />);

  return { page: within(document.body), sent };
}

afterEach(cleanup);
afterAll(clearPage);

describe("the block of a setting", () => {
  // Drift: the default, a question mark, or the setting's key would stand in the block of a setting that is at its default.
  test("shows at rest only its name, its one sentence, its control, and its unit", () => {
    drawn(SIZE);

    expect(document.body.textContent).toBe("All sites togetherThe most all sites hold, the trash included.MB");
  });

  // Drift: a changed value would not say what the default is, or Reset would put back something other than the default.
  test("names the default under a value that differs from it, with a Reset that puts it back", () => {
    const { page, sent } = drawn(SIZE, "12000MB");
    const line = page.getByText(/^Default:/).textContent;
    fireEvent.click(page.getByRole("button", { name: "Reset" }));

    expect([line, sent]).toEqual(["Default: 9,000 MBReset", ["9000MB"]]);
  });

  // Drift: two warnings would run together as one paragraph, or hide behind an icon again though the block has the room.
  test("shows the host's warnings under the control, each sentence a line of its own", () => {
    drawn({ ...SIZE, warnings: WARNINGS });

    expect(within(document.body).getAllByLabelText("Warning").map((icon) => icon.parentElement?.textContent)).toEqual(WARNINGS);
  });
});
