// The line of a setting: nothing about its default at rest, the question mark that holds the meaning, the default, and the way back to it, and one icon for the host's warnings.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { SettingRow } from "@/settings/setting-row";
import type { Row } from "@/settings/settings-queries";

/** The two sentences the host warns with in these tests. */
const WARNINGS = ["The host stores 10 GB for free.", "The host bills storage past that."];

/** A size above its default, with the host's warnings. */
const SIZE: Row = {
  key: "max_total_size",
  control: { kind: "number", least: 1, most: null, word: null },
  text: "12000MB",
  unit: "MB",
  fallback: "9000MB",
  changed: true,
  warnings: WARNINGS,
  repair: false,
};

/** Draw the line over a text, and collect every text it sends. */
function drawn(row: Row, text = row.text): { readonly page: ReturnType<typeof within>; readonly sent: string[] } {
  const sent: string[] = [];
  render(<SettingRow row={row} text={text} refusal={undefined} onChange={(next) => sent.push(next)} />);

  return { page: within(document.body), sent };
}

async function press(target: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(target);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(cleanup);
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearPage();
});

describe("the line of a setting", () => {
  // Drift: the default, the state, or the setting's key would stand on the line again, or a warning's sentences would stretch the row.
  test("shows at rest only its name, its control, and its unit", () => {
    drawn(SIZE);

    expect(document.body.textContent).toBe("Storage for all sites togetherMB");
  });

  // Drift: the question mark would lose the default, offer a reset where there is nothing to reset, or reset to something other than the default.
  test("holds the meaning, the default, and Reset to default behind the question mark, the reset only while the value differs", async () => {
    const { page, sent } = drawn(SIZE);
    await press(page.getByRole("button", { name: "About: Storage for all sites together" }));
    const note = page.getByRole("dialog").textContent;
    await press(page.getByRole("button", { name: "Reset to default" }));
    cleanup();
    const same = drawn(SIZE, SIZE.fallback);
    await press(same.page.getByRole("button", { name: "About: Storage for all sites together" }));

    expect([note, sent, same.page.queryByRole("button", { name: "Reset to default" })]).toEqual([
      "The most all sites hold together, the trash included.Default: 9,000 MBReset to default",
      ["9000MB"],
      null,
    ]);
  });

  // Drift: a warning would be a sentence under the field again, or two warnings would run together as one line.
  test("holds the host's warnings behind one icon, each sentence a line of its own", async () => {
    const { page } = drawn(SIZE);
    const icon = page.getByRole("button", { name: `Warning: ${WARNINGS.join(" ")}` });
    await press(icon);

    expect([...page.getByRole("dialog").querySelectorAll("p")].map((line) => line.textContent)).toEqual(WARNINGS);
  });
});
