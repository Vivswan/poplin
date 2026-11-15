// The Tokens tab: what a waiting row and an allowed row each let a person do, and where a waiting login is still listed with no token beside it.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { Token, Waiting, WaitingLogin } from "@/access/access-queries";
import { TokensTab } from "@/access/tokens-tab";

/** A login that waits. */
const WAITING_LOGIN = { id: "0cbb997f737c56ae", scope: "admin", computer: "build-server", asked: 1_794_700_000_000 } as WaitingLogin;

/** A token that is allowed. */
const TOKEN = { id: "cd45ee5db1827382", scope: "publisher", note: "report agent", created: 1_794_000_000_000, expires: "never" } as Token;

/** The order of a list nobody sorted. */
const UNSORTED = { key: "allowed", descending: true };

/** What the tab asked for: the logins it opened the review of, and the tokens it removed. */
const asked: { reviewed: string[]; removed: string[] } = { reviewed: [], removed: [] };

/** The changes of the screen, of which the tab removes a token. */
const ACTIONS = {
  removeToken: async (token: Token) => {
    asked.removed.push(token.id);
  },
  copyCommand: async () => undefined,
} as unknown as AccessActions;

/** Draw the tab over what the server listed. */
function Tab({ tokens = [TOKEN], failure }: { readonly tokens?: readonly Token[] | null; readonly failure?: string }): ReactNode {
  return (
    <TokensTab
      tokens={tokens ?? undefined}
      waiting={{ logins: [WAITING_LOGIN], more: 0 } as Waiting}
      failure={failure}
      waitingFailure={undefined}
      sort={UNSORTED}
      onSort={() => undefined}
      onReview={(login) => asked.reviewed.push(login.id)}
      actions={ACTIONS}
      onRetry={() => undefined}
    />
  );
}

/** The row of the table that holds a name. */
function row(name: string): ReturnType<typeof within> {
  const table = within(document.body).getByRole("table", { name: "Tokens" });
  const found = within(table)
    .getAllByRole("row")
    .find((entry) => within(entry).queryByText(name) !== null);
  if (found === undefined) throw new Error(`no row holds ${name}`);

  return within(found);
}

afterEach(() => {
  cleanup();
  asked.reviewed = [];
  asked.removed = [];
});

afterAll(clearPage);

describe("the rows of the tokens", () => {
  // Drift: a waiting login would be offered Remove, which names a token it does not have, or a token a review that no longer exists.
  test("a waiting row is marked and offers Review alone; an allowed row offers its menu alone", () => {
    render(<Tab />);

    expect(row("build-server").getByText("Waiting")).toBeDefined();
    expect(row("build-server").getByRole("button", { name: "Review build-server" })).toBeDefined();
    expect(row("build-server").queryByRole("button", { name: /^More for/ })).toBeNull();

    expect(row("report agent").queryByText("Waiting")).toBeNull();
    expect(row("report agent").queryByRole("button", { name: /^Review/ })).toBeNull();
    expect(row("report agent").getByRole("button", { name: "More for report agent" })).toBeDefined();
  });

  // Drift: Review would open nothing, or the review of another login.
  test("Review asks for the review of the row's own login", () => {
    render(<Tab />);
    fireEvent.click(row("build-server").getByRole("button", { name: "Review build-server" }));

    expect(asked.reviewed).toEqual([WAITING_LOGIN.id]);
  });
});

describe("a waiting login with no token beside it", () => {
  // Drift: with no token yet, the first login that waits would be hidden behind the empty words.
  test("it is listed where no token is", () => {
    render(<Tab tokens={[]} />);

    expect(row("build-server").getByRole("button", { name: "Review build-server" })).toBeDefined();
  });

  // Drift: a refused read of the tokens would take the waiting logins off the screen, though they were read, and nobody could allow one.
  test("it is listed where the tokens could not be read, with the refusal said under it", () => {
    render(<Tab tokens={null} failure="The tokens were not read." />);

    expect(row("build-server").getByRole("button", { name: "Review build-server" })).toBeDefined();
    expect(within(document.body).getAllByText("The tokens were not read.").length).toBeGreaterThan(0);
  });
});
