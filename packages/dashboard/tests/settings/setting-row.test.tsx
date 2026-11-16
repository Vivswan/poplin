// The row of a setting: its name, one sentence with the default after it, and its control; the way back to the default while the value differs; the same words behind the "?" a narrow column shows; and the host's warnings behind the mark after the control.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";

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
  limits: [],
  repair: false,
};

/** The same size with two limits of the host: 10,000 MB and 20,000 MB. */
const BOUNDED: Row = {
  ...SIZE,
  limits: [
    { over: 10_000, unit: "MB", warning: WARNINGS[0] ?? "" },
    { over: 20_000, unit: "MB", warning: WARNINGS[1] ?? "" },
    { over: 10_000_000, unit: "KB", warning: WARNINGS[0] ?? "" },
  ],
};

/** A setting whose default is a word, drawn by a choice alone, while a number is drawn by the choice and a field: it deletes new sites after 7 days. */
const EXPIRY: Row = {
  key: "default_expires",
  control: { kind: "number", word: "never" },
  text: "7d",
  unit: "d",
  fallback: "never",
  limits: [],
  repair: false,
};

/** One row of each kind of control, with the text it is refused at. */
const KINDS: readonly (readonly [string, Row, string])[] = [
  ["a switch", { ...SIZE, key: "update_check", control: { kind: "switch" }, unit: "", fallback: "on" }, "on"],
  ["a choice", { ...SIZE, key: "block_bots", control: { kind: "choice", options: ["auto", "on", "off"] }, unit: "", fallback: "auto" }, "auto"],
  ["a number", SIZE, "0MB"],
  ["a number that is a word now", EXPIRY, "never"],
  ["a number that can be a word", EXPIRY, "0d"],
  ["a list", { ...SIZE, key: "logins", control: { kind: "lines" }, unit: "", fallback: "" }, "one,one"],
  ["a text", { ...SIZE, key: "a_new_text" as Row["key"], control: { kind: "text" }, unit: "", fallback: "" }, "as it is"],
];

/** The row over a text it holds itself, as the screen does: a text the row sends is collected and drawn. */
function Held({ row, first, sent }: { readonly row: Row; readonly first: string; readonly sent: string[] }): ReactNode {
  const [text, setText] = useState(first);
  const take = (next: string): void => {
    sent.push(next);
    setText(next);
  };

  return <SettingRow row={row} text={text} refusal={undefined} onChange={take} marked={false} />;
}

/** Draw the row over a text, and collect every text it sends. */
function drawn(row: Row, text = row.text): { readonly page: ReturnType<typeof within>; readonly sent: string[] } {
  const sent: string[] = [];
  render(<Held row={row} first={text} sent={sent} />);

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

  // Drift: a changed value would have no way back, Reset would put back something other than the default or be one of many buttons of one name, or the focus would leave with Reset for whatever the page gives it, far from the setting.
  test("offers Reset beside the default of a value that differs from it, which puts the default back and leaves the focus in the setting's control", () => {
    const { page, sent } = drawn(SIZE, "12000MB");
    const line = page.getByText(/Default:/).textContent;
    fireEvent.click(page.getByRole("button", { name: "Reset All sites together" }));

    expect([line, sent, document.activeElement?.id]).toEqual(["The most all sites hold, the trash included. (Default: 9,000 MB) Reset", ["9000MB"], "setting-max_total_size-control"]);
  });

  // Drift: Reset would give the focus to the field of the number, which leaves once the default, a word, is drawn: the focus would be on nothing.
  test("leaves the focus after Reset in the control that shows the default, where the value was shown by another", () => {
    const { page, sent } = drawn(EXPIRY);
    fireEvent.click(page.getByRole("button", { name: /^Reset / }));

    expect([sent, document.activeElement?.getAttribute("role"), document.activeElement?.id]).toEqual([["never"], "combobox", "setting-default_expires-control"]);
  });

  // Drift: a narrow column, which hides the sentence beside the name, would have no way to read it or the default, or no way back to the default.
  test("holds the sentence, the default, and the Reset of a changed value behind the question mark too", () => {
    const { page, sent } = drawn(SIZE, "12000MB");
    fireEvent.click(page.getByRole("button", { name: "About All sites together" }));
    const lines = opened("All sites together");
    fireEvent.click(within(page.getByRole("dialog", { name: "All sites together" })).getByRole("button", { name: "Reset All sites together" }));

    expect([lines, sent]).toEqual([["The most all sites hold, the trash included.", "Default: 9,000 MBReset"], ["9000MB"]]);
  });

  // Drift: a refusal would stand under a control that does not name it, so a screen reader would never read why the value was refused; or one kind of control would be left out.
  test.each(KINDS)("names the refusal under it at its control, which is %s", (_what, row, text) => {
    render(<SettingRow row={row} text={text} refusal="Use another value." onChange={() => undefined} marked={false} />);
    const named = document.getElementById(`setting-${row.key}-control`)?.getAttribute("aria-describedby");

    expect(document.getElementById(named ?? "none")?.textContent).toBe("Use another value.");
  });

  // Drift: a control would go on naming a line that is gone once its value is taken.
  test("names nothing at a control with no line under it", () => {
    const { rerender } = render(<SettingRow row={SIZE} text="0MB" refusal="Use another value." onChange={() => undefined} marked={false} />);
    rerender(<SettingRow row={SIZE} text="1MB" refusal={undefined} onChange={() => undefined} marked={false} />);

    expect(document.getElementById("setting-max_total_size-control")?.getAttribute("aria-describedby")).toBeNull();
  });

  // Drift: a warning would have no mark after the control, or two warnings would run together as one paragraph.
  test("holds the host's warnings behind the mark after the control, each sentence a line of its own", () => {
    const { page } = drawn(BOUNDED, "20001MB");
    fireEvent.click(page.getByRole("button", { name: "Warning" }));

    expect(opened("Warning")).toEqual(WARNINGS);
  });

  // Drift: the mark would follow the stored value, so a count typed above a free limit would show no warning until it was saved, and one typed back under it would keep its mark.
  test.each([
    ["at the first limit", "10000MB", null],
    ["above the first limit", "10001MB", [WARNINGS[0]]],
    ["above both", "20001MB", WARNINGS],
    ["with no count", "MB", null],
    ["in another unit, under its own mark", "10001KB", null],
    ["in another unit, above its own mark", "10000001KB", [WARNINGS[0]]],
  ])("marks the text its control holds, saved or not: %s", (_what, text, warnings) => {
    const { page } = drawn(BOUNDED, text);
    const mark = page.queryByRole("button", { name: "Warning" });
    if (mark !== null) fireEvent.click(mark);

    expect(mark === null ? null : opened("Warning")).toEqual(warnings);
  });
});
