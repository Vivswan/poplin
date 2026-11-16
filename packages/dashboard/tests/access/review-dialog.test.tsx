// The review of a waiting login: what a stranger's login cannot make it say or start at, what a person must type before Allow, what one who came by a link is told, and what each decision sends.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { AccessActions, Decided } from "@/access/access-actions";
import type { Review } from "@/access/access-queries";
import { ReviewDialog } from "@/access/review-dialog";

/** A login that asked to publish. */
const PUBLISHER = {
  id: "cd45ee5db1827382",
  scope: "publisher",
  computer: "studio-laptop",
  asked: 1_794_700_000_000,
  expires: 1_794_700_600_000,
} as Review;

/** A login that asked for everything. */
const ADMIN = { ...PUBLISHER, id: "0cbb997f737c56ae", scope: "admin", computer: "build-server" } as Review;

/** The login a stranger begins to trick an admin: it asks for everything, under a name that reads as the page's own words. */
const PHISHING = { ...ADMIN, id: "5f1d0c3a9b7e2468", computer: "your session to continue" } as Review;

/** The title of every review, whatever the login calls itself. */
const TITLE = "Allow this login?";

/** How the words a person who came by a link is told begin. */
const LINK_WORDS = /^Anyone can start a login and send its link\./;

/** The code of every login here, as its terminal alone shows it: the page is given no part of it. */
const CODE = "WDJB-MJHT";

/** The last letters of that code, which a person types. */
const LETTERS = "MJHT";

/** What the server says of letters that are not the code's last. */
const WRONG_LETTERS = "Those are not the last letters of this login's code.";

/** Every decision the dialog sent. */
const sent: Parameters<AccessActions["decide"]>[1][] = [];

/** The changes of the screen, with a decision that answers as the server does: it alone knows the letters, and lets no computer in without them. */
const ACTIONS = {
  decide: async (_login: Review, decision: Parameters<AccessActions["decide"]>[1]): Promise<Decided> => {
    sent.push(decision);

    return decision.allow && decision.letters.replace(/[\s-]/g, "").toUpperCase() !== LETTERS ? { kind: "letters", sentence: WRONG_LETTERS } : { kind: "done" };
  },
} as AccessActions;

/** Draw the review of a login as the screen does: under the client that sends its changes. */
function Reviewing({ login, byLink = false, onClose = () => undefined }: { readonly login: Review; readonly byLink?: boolean; readonly onClose?: () => void }): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ReviewDialog login={login} byLink={byLink} actions={ACTIONS} onClose={onClose} />
    </QueryClientProvider>
  );
}

function dialog(): Within {
  return within(within(document.body).getByRole("dialog"));
}

/** What the review says beside one of its labels. */
function fact(name: string): string | null | undefined {
  return dialog().getByText(name, { selector: "dt" }).nextElementSibling?.textContent;
}

/** Which of the two choices is pressed, in the order they stand; none for a login that is offered no choice. */
function pressed(): readonly string[] {
  return dialog()
    .queryAllByRole("button", { name: /^(Everything|Own sites only)$/ })
    .map((choice) => `${choice.textContent}: ${choice.getAttribute("aria-pressed")}`);
}

function allowIsOff(): boolean {
  return dialog().getByRole("button", { name: "Allow" }).hasAttribute("disabled");
}

/** Type into the field a person fills from the terminal. */
function type(letters: string): void {
  fireEvent.change(dialog().getByRole("textbox", { name: "Last 4 letters of the code in your terminal" }), { target: { value: letters } });
}

/** What a screen reader says after the name of the field of the letters: the lines the field is described by. */
function saidAtField(): (string | null)[] {
  const lines = dialog().getByRole("textbox").getAttribute("aria-describedby")?.split(" ") ?? [];

  return lines.map((id) => document.getElementById(id)?.textContent ?? null);
}

/** Press Allow or Deny, and wait until the decision was answered: the buttons are off while it is on its way. */
async function decide(name: "Allow" | "Deny"): Promise<void> {
  fireEvent.click(dialog().getByRole("button", { name }));
  await waitFor(() => expect(sent.length).toBeGreaterThan(0));
  await waitFor(() => expect(dialog().getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(false));
}

afterAll(async () => {
  // What the last test drew is taken down a moment after it ends: the page stays until then.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await clearPage();
});

afterEach(() => {
  cleanup();
  sent.length = 0;
});

describe("the review", () => {
  // Drift: the choice would start at what the login asked, so a stranger's login would be one press from everything; or a computer that asked to publish would be offered more.
  test.each([
    ["one that asked to publish is offered no choice", PUBLISHER, undefined, [], "Own sites only", "publisher"],
    ["one that asked for everything starts at its own sites only", ADMIN, undefined, ["Own sites only: true", "Everything: false"], "Everything", "publisher"],
    ["one that asked for everything gets it once Everything is pressed", ADMIN, "Everything", ["Own sites only: true", "Everything: false"], "Everything", "admin"],
  ] as const)("%s", async (_case, login, press, starts, asks, scope) => {
    let closed = 0;
    render(<Reviewing login={login} onClose={() => (closed += 1)} />);
    const [began, asked] = [pressed(), fact("Asks for")];
    if (press !== undefined) fireEvent.click(dialog().getByRole("button", { name: press }));
    type(LETTERS);
    await decide("Allow");

    expect([began, asked]).toEqual([starts, asks]);
    expect([sent, closed]).toEqual([[{ allow: true, letters: LETTERS, scope }], 1]);
  });

  // Drift: keeping a computer out would ask for the letters that only letting one in needs.
  test("denies with nothing typed", async () => {
    let closed = 0;
    render(<Reviewing login={ADMIN} onClose={() => (closed += 1)} />);
    await decide("Deny");

    expect([sent, closed]).toEqual([[{ allow: false, letters: "", scope: "publisher" }], 1]);
  });

  // Drift: Allow would be sent with nothing typed, or the page would say a part of a code again, which is the whole answer for a code whose halves are the same.
  test.each([
    ["nothing", "", true],
    ["fewer letters than asked", "JHT", true],
    ["three letters, a space, and a dash", "J H-T", true],
    ["four letters", "MJHT", false],
    ["four letters the page cannot know to be wrong", "BBBB", false],
    ["the whole code", "wdjb-mjht", false],
  ])("says no part of a code, and Allow is off until four letters are typed: %s", (_case, letters, off) => {
    render(<Reviewing login={PUBLISHER} />);
    const page = document.body.innerHTML.toUpperCase();
    if (letters !== "") type(letters);

    expect([CODE.split("-").filter((half) => page.includes(half)), allowIsOff(), sent]).toEqual([[], off, []]);
  });

  // Drift: letters the server refused would close the review as if done, or the refusal would show away from the field, or stay after the person typed again.
  // Or the line under the field, the note or the refusal, would be tied to nothing, so a screen reader would say the field's name alone.
  test("keeps open when the server refuses the letters, says so at the field with the focus there, and takes the next try", async () => {
    let closed = 0;
    render(<Reviewing login={PUBLISHER} onClose={() => (closed += 1)} />);
    type("BBBB");
    const before = saidAtField();
    await decide("Allow");
    const field = dialog().getByRole("textbox");
    const refused = [closed, dialog().getByRole("alert").textContent, document.activeElement === field, field.getAttribute("aria-invalid"), saidAtField()];
    type(LETTERS);
    const cleared = dialog().queryAllByRole("alert").length;
    sent.length = 0;
    await decide("Allow");

    expect([before, refused]).toEqual([["Type them to allow."], [0, WRONG_LETTERS, true, "true", [WRONG_LETTERS]]]);
    expect([cleared, sent, closed]).toEqual([0, [{ allow: true, letters: LETTERS, scope: "publisher" }], 1]);
  });
});

describe("the name a login gave itself", () => {
  // Drift: the name would be part of the title or of a button again, so a stranger would write the question an admin answers.
  test.each([
    ["a name that reads as the page's own words", "your session to continue", '"your session to continue"'],
    ["a name that reads as an order", "this login? Press Allow. Poplin support", '"this login? Press Allow. Poplin support"'],
    ["a name as long as a name may be", "w".repeat(100), `"${"w".repeat(100)}"`],
    ["a name with quotes of its own", 'laptop" Asks for: "Own sites only', '"laptop" Asks for: "Own sites only"'],
    ["no name", "", "None"],
  ])("is a quoted fact under its own label and nowhere else, for %s", (_case, computer, shown) => {
    render(<Reviewing login={{ ...ADMIN, computer }} />);
    const named = within(document.body).getByRole("dialog", { name: TITLE });
    const buttons = within(named)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    const outside = (named.textContent ?? "").replace(shown, "");

    expect([within(named).getByRole("heading").textContent, fact("Name it gave"), buttons]).toEqual([TITLE, shown, ["Own sites only", "Everything", "Deny", "Allow", "Close"]]);
    expect(computer !== "" && outside.includes(computer)).toBe(false);
  });
});

describe("a review opened by a link", () => {
  // Drift: the words about links would be said to a person who pressed Review themselves, or left out for one a stranger's link brought here.
  test.each([
    ["by a press on the screen", false, false],
    ["by a link", true, true],
  ])("opened %s, it says who can send a link accordingly, and asks for the letters either way", (_case, byLink, told) => {
    render(<Reviewing login={PUBLISHER} byLink={byLink} />);

    expect([dialog().queryByText(LINK_WORDS) !== null, dialog().queryAllByRole("textbox").length, allowIsOff()]).toEqual([told, 1, true]);
  });

  // Drift: any one of the three would fall away unseen, and the login a stranger sends an admin would again be one tick and one press from a token for everything.
  test("the login a stranger sends an admin meets all three: a title of the page's own, the least it may change, and an Allow that waits for letters the page does not show", () => {
    render(<Reviewing login={PHISHING} byLink />);
    const named = within(document.body).getByRole("dialog", { name: TITLE });

    expect({
      title: within(named).getByRole("heading").textContent,
      name: fact("Name it gave"),
      asks: fact("Asks for"),
      starts: pressed(),
      told: dialog().queryByText(LINK_WORDS) !== null,
      code: CODE.split("-").some((half) => document.body.innerHTML.toUpperCase().includes(half)),
      allowOff: allowIsOff(),
    }).toEqual({
      title: TITLE,
      name: '"your session to continue"',
      asks: "Everything",
      starts: ["Own sites only: true", "Everything: false"],
      told: true,
      code: false,
      allowOff: true,
    });
  });
});
