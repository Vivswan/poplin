// The pieces of the domain as a screen draws them: one row per piece.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";

import { Pieces } from "@/domain/pieces";

/** A run with one piece of each way a state is read. */
const ROWS = [
  { piece: "DNS record", state: "present", tone: "good", detail: "every site" },
  { piece: "Login policy", state: "differs", tone: "bad", detail: "the logins of the settings" },
  { piece: "Rate rule", state: "not set up: optional", tone: "idle", detail: "sample-rate-rule: add this right to the token and press Repair: Rules: Edit" },
] as const;

afterEach(cleanup);
afterAll(clearPage);

// Drift: a row would lose its piece, its state, or its detail, or the rows would be drawn in another order than the one a repair works in.
test("the pieces are one row each, in the order given, under the headings Piece, State, Detail", () => {
  render(<Pieces rows={ROWS} />);
  const table = within(document.body).getByRole("table", { name: "Pieces" });
  const cells = [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent));

  expect([...table.querySelectorAll("thead th")].map((head) => head.textContent?.trim())).toEqual(["Piece", "State", "Detail"]);
  expect(cells).toEqual(ROWS.map((row) => [row.piece, row.state, row.detail]));
});
