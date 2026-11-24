// The status of the domain as plain text and as the line over the pieces: what the text holds and leaves out, how its columns line up, and where the line names the version.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";

import { type Status, StatusLine, statusText, versionOf } from "@/domain/status-line";

/** A check of a set minute that found every piece in place. */
const CHECK = {
  run: "check",
  ran_at: Date.UTC(2026, 0, 1, 0, 0, 59),
  rows: [
    { piece: "DNS record", state: "unchanged", detail: "poplin.example.com" },
    { piece: "Login policy", state: "unchanged", detail: "your users only" },
  ],
} as const;

/** A status with every piece in place. */
const STANDING: Status = { version: "0.1.2", kind: "under a domain", line: "Nothing to repair", ran: CHECK, failure: undefined, asking: [], mended: [] };

/** A repair as the screen holds it whole, with a step only a person can do: its words name a user and its address names the account. */
const REPAIR = {
  ok: true,
  run: "repair",
  ran_at: Date.UTC(2026, 0, 1),
  rows: [{ piece: "Key", state: "failed", tone: "bad", detail: "poplin key: the account token lacks a permission" }],
  steps: [{ text: "Ask you@example.com to delete the older key at the provider:", address: "https://provider.example/0123456789abcdef0123456789abcdef/api-tokens" }],
  summary: { line: "1 not done", tone: "bad" },
  waiting: 0,
  repaired: 0,
} as const;

/** The name of a piece in two letters that each take two cells. */
const WIDE = "\u8a18\u9332";

afterEach(cleanup);
afterAll(clearPage);

describe("the status as plain text", () => {
  // Drift: a paste would hold the rows to repair alone, columns that do not line up, a time in the reader's own time zone, or a count beside problems it does not name.
  test.each([
    [
      "every piece in place",
      STANDING,
      ["poplin 0.1.2, under a domain. Checked 2026-01-01T00:00Z. Nothing to repair.", "unchanged  DNS record    poplin.example.com", "unchanged  Login policy  your users only"],
    ],
    [
      "pieces to repair and a problem that asks for a repair, on an install without a domain",
      {
        ...STANDING,
        kind: "without a domain",
        line: "3 to repair",
        asking: ["A change of the users or the alerts did not take effect"],
        ran: {
          ...CHECK,
          rows: [
            { piece: "Address", state: "unchanged", detail: "the open sites" },
            { piece: "Address", state: "missing", detail: "the private sites" },
            { piece: "Login policy", state: "needs repair", detail: "your users only: missing or changed" },
            { piece: "Spend alert", state: "skipped", detail: "" },
          ],
        },
      },
      [
        "poplin 0.1.2, without a domain. Checked 2026-01-01T00:00Z. 3 to repair.",
        "To repair: A change of the users or the alerts did not take effect",
        "unchanged     Address       the open sites",
        "missing       Address       the private sites",
        "needs repair  Login policy  your users only: missing or changed",
        "skipped       Spend alert",
      ],
    ],
    [
      "a repair that ended a problem, on a line that is a sentence already",
      {
        ...STANDING,
        line: "Users or alerts changed. Press Repair.",
        mended: ["The install could not repair its own login"],
        ran: { run: "repair", ran_at: Date.UTC(2026, 11, 31, 23, 59), rows: [{ piece: "DNS record", state: "created", detail: "poplin.example.com" }] },
      },
      ["poplin 0.1.2, under a domain. Repaired 2026-12-31T23:59Z. Users or alerts changed. Press Repair.", "Repaired: The install could not repair its own login", "created  DNS record  poplin.example.com"],
    ],
    ["no run yet", { ...STANDING, line: "Not checked yet", ran: undefined }, ["poplin 0.1.2, under a domain. Not checked yet."]],
    [
      "a check that read nothing, and a version the page could not read",
      { ...STANDING, version: undefined, line: "Not checked", ran: undefined, failure: "No answer from the provider. Try again." },
      ["poplin, under a domain. Not checked. No answer from the provider. Try again."],
    ],
    [
      "a piece named in letters two cells wide",
      { ...STANDING, ran: { ...CHECK, rows: [{ piece: WIDE, state: "unchanged", detail: "poplin.example.com" }, ...CHECK.rows] } },
      [
        "poplin 0.1.2, under a domain. Checked 2026-01-01T00:00Z. Nothing to repair.",
        `unchanged  ${WIDE}          poplin.example.com`,
        "unchanged  DNS record    poplin.example.com",
        "unchanged  Login policy  your users only",
      ],
    ],
  ] as const)("is the install, when the run was in UTC, and the count, then every problem that asks for a repair or that a repair ended, and every piece in columns that line up: %s", (_name, status, lines) => {
    expect(statusText(status).split("\n")).toEqual([...lines]);
  });

  // Drift: the screen hands the run over whole, and a run holds the steps only a person can do, whose words are the provider's and whose addresses name the account. A text built from the whole run would carry them into a public issue.
  test("holds no step of the run it is fed whole: neither the user its words name nor the account its address names", () => {
    const lines = statusText({ ...STANDING, line: "1 not done", ran: REPAIR }).split("\n");

    expect(lines).toEqual(["poplin 0.1.2, under a domain. Repaired 2026-01-01T00:00Z. 1 not done.", "failed  Key  poplin key: the account token lacks a permission"]);
  });
});

describe("the line over the pieces", () => {
  // Drift: the line would name no version, put it before the count, or say "poplin undefined" on a page that was handed none.
  test.each([
    ["a version", "0.1.2", "Nothing to repairChecked nowpoplin 0.1.2"],
    ["an empty version", "", "Nothing to repairChecked now"],
    ["no version", undefined, "Nothing to repairChecked now"],
    ["a version that is no text", 12, "Nothing to repairChecked now"],
  ])("names the version the page was handed last, and nothing for one it cannot read: %s", (_name, handed, line) => {
    render(<StatusLine line="Nothing to repair" tone="good" beside="Checked now" version={versionOf(handed)} />);

    expect(within(document.body).getByRole("status").textContent).toBe(line);
  });
});
