// The removed tokens: folded away until a person opens them, which the browser keeps, each said with how it ended, and not drawn at all where no token ended.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

import type { Ended, EndedToken } from "@/access/access-queries";
import { RemovedTokens } from "@/access/removed-tokens";

/** A day in November 2026, in milliseconds since the epoch. */
const THEN = 1_794_000_000_000;

/** A token that ended, with one name for all its times. */
function ended(id: string, note: string, how: { readonly by?: string; readonly scope?: EndedToken["scope"]; readonly how?: EndedToken["how"] }): EndedToken {
  return { id, note, scope: "publisher", created: THEN, ended: THEN + 1000, how: "removed", by: "mira@example.com", ...how } as EndedToken;
}

/** One token that ended each way: by a person, by another token, by itself, by its time, and with its user, whoever removed that user. */
const TOKENS = [
  ended("00000000000000a1", "old laptop", {}),
  ended("00000000000000a2", "intern laptop", { by: "00000000000000cc" }),
  ended("00000000000000a3", "nightly build", { by: "00000000000000a3" }),
  ended("00000000000000a4", "old server", { by: "00000000000000dd" }),
  ended("00000000000000a5", "first setup", { scope: "admin", how: "ran_out", by: undefined }),
  ended("00000000000000a6", "jonas laptop", { how: "user_removed" }),
  ended("00000000000000a7", "jonas agent", { how: "user_removed", by: "00000000000000a7" }),
];

/** The name of the one token the list can name. */
const NAMES = { "00000000000000cc": "report agent" };

/** The button that opens and closes the list. */
function opener(): HTMLElement {
  return within(document.body).getByRole("button", { name: /^Removed tokens/ });
}

/** What the open table says in each row: the name, then how the token ended. */
function said(): string[][] {
  const table = within(document.body).getByRole("table", { name: "Removed tokens" });

  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => [row.querySelector("td")?.textContent ?? "", row.querySelector("td:nth-child(2)")?.textContent ?? ""]);
}

function drawn(list: Ended): void {
  render(<RemovedTokens ended={list} names={NAMES} />);
}

afterEach(cleanup);

afterAll(clearPage);

describe("the removed tokens", () => {
  // Drift: the words of an end are joined here from the answer's `how` and `by` and the shared writer of who did a thing. A token that gave itself back would read as removed by its own name, or a remover with no name left would be written as an id.
  test("open into the shared table, each saying how it ended: by whom it was removed, that it logged out, that it ran out, or that its user was removed", () => {
    drawn({ tokens: TOKENS, more: false });
    fireEvent.click(opener());

    expect(said()).toEqual([
      ["old laptop", "Removed by mira@example.com"],
      ["intern laptop", "Removed by report agent"],
      ["nightly build", "Logged out"],
      ["old server", "Removed by a token"],
      ["first setup", "Ran out"],
      ["jonas laptop", "Its user was removed"],
      ["jonas agent", "Its user was removed"],
    ]);
  });

  // Drift: dead tokens would crowd the screen at rest, or a person who opened the list would find it closed after every visit, or closed it and find it open.
  test("are folded away at first, stay open on the next visit once opened, and closed once closed again", () => {
    drawn({ tokens: TOKENS, more: false });
    const first = [opener().getAttribute("aria-expanded"), within(document.body).queryByRole("table")];
    fireEvent.click(opener());
    cleanup();
    drawn({ tokens: TOKENS, more: false });
    const reopened = opener().getAttribute("aria-expanded");
    fireEvent.click(opener());
    cleanup();
    drawn({ tokens: TOKENS, more: false });

    expect([first, reopened, opener().getAttribute("aria-expanded")]).toEqual([["false", null], "true", "false"]);
  });
});
