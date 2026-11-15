// The pieces of the domain as a screen draws them: the line that counts them, what is said beside and under it, the steps only a person can do, and one row per piece.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";

import { Pieces } from "@/domain/pieces";

/** A run with one piece of each way a state is read. */
const ROWS = [
  { piece: "DNS record", state: "present", tone: "good", detail: "every site" },
  { piece: "Login policy", state: "differs", tone: "bad", detail: "the logins of the settings" },
  { piece: "Rate rule", state: "not set up: optional", tone: "idle", detail: "sample-rate-rule: add this right to the token and press Repair: Rules: Edit" },
] as const;

/** The line over those rows. */
const SUMMARY = {
  line: "1 to repair",
  tone: "bad",
  next: "Paste the token again and press Repair.",
  optional: "1 optional, not set up. The install works without them.",
} as const;

afterEach(cleanup);
afterAll(clearPage);

describe("the pieces", () => {
  // Drift: a row would lose its piece, its state, or its detail, or the rows would be drawn in another order than the one a repair works in.
  test("are one row each, in the order given, under the headings Piece, State, Detail", () => {
    render(<Pieces summary={SUMMARY} rows={ROWS} steps={[]} />);
    const table = within(document.body).getByRole("table", { name: "Pieces" });
    const cells = [...table.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent));

    expect([...table.querySelectorAll("thead th")].map((head) => head.textContent?.trim()).filter((words) => words !== "Actions")).toEqual([
      "Piece",
      "State",
      "Detail",
    ]);
    expect(cells).toEqual(ROWS.map((row) => [row.piece, row.state, row.detail]));
  });

  // Drift: a step only a person can do would be said with no way to its address, or the address would be opened with the page's own address sent along.
  test("say each step a person must do, with its address as a link that opens in a new tab", () => {
    render(
      <Pieces summary={SUMMARY} rows={ROWS} steps={[{ text: "The login is ready. Open your dashboard and log in:", address: "https://poplin.example.com" }]} />,
    );
    const link = within(document.body).getByRole("link", { name: "https://poplin.example.com" }) as HTMLAnchorElement;

    expect([link.href, link.target, link.rel]).toEqual(["https://poplin.example.com/", "_blank", "noreferrer"]);
    expect(link.closest("li")?.textContent).toContain("The login is ready. Open your dashboard and log in:");
  });
});
