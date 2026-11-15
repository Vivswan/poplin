// The control of each kind of setting: every kind the server can name draws a control that a person can change, and says what it holds.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

import { CONTROL_KINDS } from "../../../app/src/console/setting-controls";

import { SettingControl } from "@/settings/setting-control";
import type { Row } from "@/settings/settings-queries";

/** One row of each kind of control, with the role its control has and the text it holds. */
const BY_KIND: Readonly<Record<string, { readonly row: Row; readonly role: string }>> = {
  switch: { row: rowOf("update_check", { kind: "switch" }, "on"), role: "switch" },
  choice: { row: rowOf("block_bots", { kind: "choice", options: ["auto", "on", "off"] }, "auto"), role: "combobox" },
  number: { row: rowOf("trash_days", { kind: "number", least: 1, most: null }, "7"), role: "textbox" },
  lines: { row: rowOf("logins", { kind: "lines" }, "mira@example.com"), role: "textbox" },
  text: { row: rowOf("max_total_size", { kind: "text" }, "9GB"), role: "textbox" },
};

function rowOf(key: string, control: Row["control"], text: string): Row {
  return { key: key as Row["key"], control, text, suffix: "", fallback: text, changed: false, warning: null, elsewhere: false };
}

afterAll(clearPage);

afterEach(cleanup);

describe("the control of a setting", () => {
  // Drift: the server would name a kind of control the screen does not draw, and that setting's row would have nothing to change it with.
  test.each([...new Set(Object.values(CONTROL_KINDS))])("of the kind %s is drawn as one control a person can change", (kind) => {
    const { row, role } = BY_KIND[kind] ?? { row: rowOf("none", { kind: "text" }, ""), role: "none" };
    render(<SettingControl row={row} id="the-control" shown={row.text} onChange={() => undefined} refused={false} />);

    expect(within(document.body).getAllByRole(role)).toHaveLength(1);
  });

  // Drift: an on or off setting would be free text again, or a press on its switch would send something other than on or off.
  test("of an on or off setting is a switch that sends on or off", () => {
    const sent: string[] = [];
    render(<SettingControl row={BY_KIND.switch?.row as Row} id="the-control" shown="on" onChange={(shown) => sent.push(shown)} refused={false} />);
    const control = within(document.body).getByRole("switch");
    fireEvent.click(control);

    expect([control.getAttribute("aria-checked"), sent]).toEqual(["true", ["off"]]);
  });

  // Drift: a refused value would vanish from its field, or the field would not be marked as the one refused.
  test("of a number keeps what was typed, shows its unit, and marks a refusal", () => {
    render(<SettingControl row={BY_KIND.number?.row as Row} id="the-control" shown="soon" onChange={() => undefined} refused />);
    const field = within(document.body).getByRole("textbox") as HTMLInputElement;

    expect([field.value, field.getAttribute("aria-invalid"), document.body.textContent]).toEqual(["soon", "true", "days"]);
  });
});
