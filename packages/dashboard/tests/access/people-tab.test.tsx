// The People tab: who has no Remove, what is asked before a person is taken out or every browser is signed out, and where a refused email is said.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { AccessActions } from "@/access/access-actions";
import { PeopleTab } from "@/access/people-tab";

/** The people of the test install: the one logged in here, and one more. */
const PEOPLE = { ok: true as const, logins: ["mira@example.com", "jonas@example.com"], you: "mira@example.com" };

/** What the server says of an email that is none. */
const NOT_AN_EMAIL = "Type an email address, such as name@example.com.";

/** What the tab asked the screen to change. */
const done: { removed: string[]; added: string[]; signedOut: number } = { removed: [], added: [], signedOut: 0 };

/** The changes of the screen, with an add that refuses whatever holds no at sign, as the server does. */
const ACTIONS = {
  removePerson: async (email: string) => {
    done.removed.push(email);
  },
  addPerson: async (email: string) => {
    if (!email.includes("@")) return NOT_AN_EMAIL;

    done.added.push(email);

    return undefined;
  },
  signEveryoneOut: async () => {
    done.signedOut += 1;
  },
} as unknown as AccessActions;

function Tab(): ReactNode {
  return <PeopleTab people={PEOPLE} failure={undefined} actions={ACTIONS} onRetry={() => undefined} />;
}

const page = (): ReturnType<typeof within> => within(document.body);

/** The row of the table that holds an email. */
function row(email: string): ReturnType<typeof within> {
  const found = within(page().getByRole("table", { name: "Users" }))
    .getAllByRole("row")
    .find((entry) => within(entry).queryByText(email) !== null);
  if (found === undefined) throw new Error(`no row holds ${email}`);

  return within(found);
}

afterEach(() => {
  cleanup();
  done.removed = [];
  done.added = [];
  done.signedOut = 0;
});

afterAll(clearPage);

describe("the rows of the people", () => {
  // Drift: the person logged in here would be offered a Remove the server always refuses.
  test("the person logged in here is marked and has no menu; another person has one", () => {
    render(<Tab />);

    expect(row("mira@example.com").getByText("you")).toBeDefined();
    expect(row("mira@example.com").queryByRole("button")).toBeNull();
    expect(row("jonas@example.com").queryByText("you")).toBeNull();
    expect(row("jonas@example.com").getByRole("button", { name: "More for jonas@example.com" })).toBeDefined();
  });
});

describe("signing everyone out", () => {
  // Drift: one press in the toolbar would end every session, this one included, with nothing asked.
  test.each([
    ["Cancel", 0],
    ["Sign everyone out", 1],
  ])("the button asks first, and %s ends %p times", async (answer, times) => {
    render(<Tab />);
    fireEvent.click(page().getByRole("button", { name: "Sign everyone out" }));
    const question = within(page().getByRole("alertdialog"));

    expect(question.getByText("Sign everyone out?")).toBeDefined();
    expect(done.signedOut).toBe(0);

    fireEvent.click(question.getByRole("button", { name: answer }));
    // The answer is acted on within the press; a turn later nothing more follows it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(done.signedOut).toBe(times);
  });
});

describe("adding a person", () => {
  // Drift: a refused email would close the dialog or empty the field, and the person would type it all again.
  test("a refused email is said at the field, which keeps what was typed; a good one is sent", async () => {
    render(<Tab />);
    fireEvent.click(page().getByRole("button", { name: "Add a user" }));
    const dialog = within(page().getByRole("dialog"));
    const field = dialog.getByLabelText("Email") as HTMLInputElement;

    fireEvent.change(field, { target: { value: "jonas" } });
    fireEvent.click(dialog.getByRole("button", { name: "Add a user" }));
    await waitFor(() => expect(dialog.queryByText(NOT_AN_EMAIL) === null).toBe(false));

    expect(field.value).toBe("jonas");
    expect(done.added).toEqual([]);

    fireEvent.change(field, { target: { value: "ada@example.com" } });
    fireEvent.click(dialog.getByRole("button", { name: "Add a user" }));
    await waitFor(() => expect(done.added).toEqual(["ada@example.com"]));
  });
});
