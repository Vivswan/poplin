// The People tab: who has no Remove, what is asked before a person is taken out or every browser is signed out, and where a refused email is said.
// The question before a person is taken out counts the tokens that end with that person.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { People } from "@/access/access-queries";
import { PeopleTab } from "@/access/people-tab";

/** The people of the test install: the one logged in here, one more who allowed two tokens, one who allowed one, and one who allowed none. */
const PEOPLE = {
  ok: true,
  users: ["mira@example.com", "jonas@example.com", "lena@example.com", "omar@example.com"],
  you: "mira@example.com",
  tokens: { "mira@example.com": 4, "jonas@example.com": 2, "lena@example.com": 1 },
} as unknown as People;

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

const page = (): Within => within(document.body);

/** The row of the table that holds an email. */
function row(email: string): Within {
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

describe("taking a person out", () => {
  // Drift: a person's tokens end with the person. A question that did not say so would have an admin break a build server by removing a colleague, and one that named tokens where there are none would worry for nothing.
  test.each([
    ["jonas@example.com", "This user can no longer log in. Their 2 tokens stop working."],
    ["lena@example.com", "This user can no longer log in. Their 1 token stops working."],
    ["omar@example.com", "This user can no longer log in."],
  ])("the question before %s is removed says %j, and Remove sends the email", async (email, says) => {
    render(<Tab />);
    fireEvent.click(row(email).getByRole("button", { name: `More for ${email}` }));
    fireEvent.click(await waitFor(() => page().getByRole("menuitem", { name: "Remove" })));
    const question = within(await waitFor(() => page().getByRole("alertdialog")));

    expect([question.getByText(`Remove ${email}?`).textContent, question.getByText(says).textContent]).toEqual([`Remove ${email}?`, says]);

    fireEvent.click(question.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(done.removed).toEqual([email]));
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
