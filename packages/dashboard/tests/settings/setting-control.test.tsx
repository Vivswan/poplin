// The control of each kind of setting: every kind the server can name draws a control that a person can change, a number has its unit fixed beside it, and nothing is typed as a word.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Field } from "@base-ui/react/field";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { type ReactNode, useState } from "react";

import { CONTROL_KINDS } from "../../../app/src/console/settings/setting-controls";

import { SettingControl } from "@/settings/setting-control";
import type { Row } from "@/settings/settings-queries";

/** One row of each kind of control, with the role its control has. */
const BY_KIND: Readonly<Record<string, { readonly row: Row; readonly role: string }>> = {
  switch: { row: rowOf("update_check", { kind: "switch" }, "on"), role: "switch" },
  choice: { row: rowOf("block_bots", { kind: "choice", options: ["auto", "on", "off"] }, "auto"), role: "combobox" },
  number: { row: rowOf("trash_days", { kind: "number", word: null }, "7"), role: "textbox" },
  lines: { row: rowOf("a_new_list", { kind: "lines" }, "one,two"), role: "textbox" },
  text: { row: rowOf("a_new_text", { kind: "text" }, "as it is"), role: "textbox" },
};

function rowOf(key: string, control: Row["control"], text: string, unit = ""): Row {
  return { key: key as Row["key"], control, text, unit, fallback: text, limits: [], repair: false, needs: null };
}

/** Draw the control of a row over a text, and collect every text it sends. */
function drawn(row: Row, text = row.text): { readonly page: Within; readonly sent: string[] } {
  const sent: string[] = [];
  render(
    <Field.Root>
      <SettingControl row={row} id="the-control" text={text} onChange={(next) => sent.push(next)} refused={false} />
    </Field.Root>,
  );

  return { page: within(document.body), sent };
}

/** The control of a row over the text it sent last, as a row of the screen holds it. */
function Held({ row, sent }: { readonly row: Row; readonly sent: string[] }): ReactNode {
  const [text, setText] = useState(row.text);
  const keep = (next: string): void => {
    sent.push(next);
    setText(next);
  };

  return (
    <Field.Root>
      <SettingControl row={row} id="the-control" text={text} onChange={keep} refused={false} />
    </Field.Root>
  );
}

afterAll(clearPage);

afterEach(cleanup);

describe("the control of a setting", () => {
  // Drift: the server would name a kind of control the screen does not draw, and that setting's row would have nothing to change it with.
  test.each([...new Set(Object.values(CONTROL_KINDS))])("of the kind %s is drawn as one control a person can change", (kind) => {
    const { row, role } = BY_KIND[kind] ?? { row: rowOf("none", { kind: "text" }, ""), role: "none" };

    expect(drawn(row).page.getAllByRole(role)).toHaveLength(1);
  });

  // Drift: an on or off setting would be free text again, or a choice of two drawn as a switch would send on or off, which it does not take.
  test.each([
    [BY_KIND.switch?.row as Row, "on", "off"],
    [rowOf("outside_pages", { kind: "choice", options: ["blocked", "allowed"] }, "allowed"), "allowed", "blocked"],
  ])("%#: an on or off is a switch that sends the setting's own text", (row, on, off) => {
    const { page, sent } = drawn(row, on);
    const control = page.getByRole("switch");
    fireEvent.click(control);

    expect([control.getAttribute("aria-checked"), sent]).toEqual(["true", [off]]);
  });

  // Drift: a size would be typed with its unit again, or shown as the count of GB it was stored in beside a fixed MB.
  test("of a size is a number with MB fixed beside it, shown with separators and sent with its unit", () => {
    const { page, sent } = drawn(rowOf("max_total_size", { kind: "number", word: null }, "9000MB", "MB"));
    const field = page.getByRole("textbox") as HTMLInputElement;
    const shown = field.value;
    fireEvent.change(field, { target: { value: "12000" } });

    expect([shown, document.body.textContent, sent]).toEqual(["9,000", "MB", ["12000MB"]]);
  });

  // Drift: a count typed as 1.5 would become 2 when the field is left, and be saved as 2 with nothing said.
  test("of a count typed with a fraction keeps it when the field is left, and sends it as typed", () => {
    const sent: string[] = [];
    render(<Held row={rowOf("max_total_size", { kind: "number", word: null }, "9000MB", "MB")} sent={sent} />);
    const field = within(document.body).getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "1.5" } });
    fireEvent.blur(field);

    expect([field.value, sent.at(-1)]).toEqual(["1.5", "1.5MB"]);
  });

  // Drift: a count the field's library does not take would be sent as the nearest one it does, the largest a number holds exactly or 0, and saved with nothing said, where the server refuses the count as it is.
  test.each([
    ["twenty nines", "99999999999999999999", "100000000000000000000"],
    ["two above the largest exact count", "9007199254740993", "9007199254740992"],
    ["a count below 0", "-5", "-5"],
  ])("of a count the server refuses sends it as large or as small as it was typed: %s", (_what, typed, text) => {
    const { page, sent } = drawn(rowOf("versions_kept", { kind: "number", word: null }, "5"));
    fireEvent.change(page.getByRole("textbox"), { target: { value: typed } });

    expect(sent).toEqual([text]);
  });

  // Drift: an emptied field of a setting that takes no number would send an empty text, which the server refuses, where empty has a meaning.
  test("of a count that may be none says what empty means and sends the word for an emptied field", () => {
    const { page, sent } = drawn(rowOf("max_sites", { kind: "number", word: "none" }, "40"));
    const field = page.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });

    expect([field.placeholder, sent]).toEqual(["No limit", ["none"]]);
  });

  // Drift: Never would be a word typed into a field again, or the days would stay on the screen while Never is chosen.
  test("of a span that may be never is a choice, with the field of days only while a span is chosen", () => {
    const expires = rowOf("default_expires", { kind: "number", word: "never" }, "never", "d");
    const never = drawn(expires);
    const chosenNever = [never.page.getByRole("combobox").textContent?.includes("Never"), never.page.queryByRole("textbox")];
    cleanup();
    const after = drawn(expires, "30d");
    fireEvent.change(after.page.getByRole("textbox"), { target: { value: "7" } });

    expect([chosenNever, after.page.getByRole("combobox").textContent?.includes("After"), document.body.textContent?.includes("days"), after.sent]).toEqual([[true, null], true, true, ["7d"]]);
  });
});
