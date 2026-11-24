// The review of a waiting login: what a stranger's login cannot make it say or start at, what a person must type or paste before Approve, what one who came by a link is told, and what each decision sends.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseUserCode } from "@poplin/core/src/auth/computer-logins";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { AccessActions, Decided, Decision } from "@/access/access-actions";
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
const TITLE = "Approve this login?";

/** How the words a person who came by a link is told begin. */
const LINK_WORDS = /^Anyone can start a login and send its link\./;

/** The code of every login here, as its terminal alone shows it: the page is given no part of it. */
const CODE = "WDJB-MJHT";

/** What the server says of a text that is not the code. */
const WRONG_CODE = "That is not this login's code.";

/** Every decision the dialog sent. */
const sent: Decision[] = [];

/** The changes of the screen, with a decision that answers as the server does: it alone knows the code, and lets no computer in without the whole of it. */
const ACTIONS = {
  decide: async (decision: Decision, _asked: Review["scope"]): Promise<Decided> => {
    sent.push(decision);

    return decision.allow && parseUserCode(decision.code) !== parseUserCode(CODE) ? { kind: "code", sentence: WRONG_CODE } : { kind: "done" };
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
    .queryAllByRole("button", { name: /^(Admin|Publisher)$/ })
    .map((choice) => `${choice.textContent}: ${choice.getAttribute("aria-pressed")}`);
}

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** How a moment is written: the day with two figures, and the time to the minute. */
const MOMENT = /^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/;

/** A minute in milliseconds. */
const MINUTE_MS = 60_000;

/** The moment a review opens at, in the tests that move the clock before Approve is pressed. */
const OPENED = Date.UTC(2031, 4, 6, 12, 0, 0);

/** The moment so many days after the review opened, as a decision sends it. */
function after(days: number): string {
  return new Date(OPENED + days * DAY_MS).toISOString();
}

/** When the token expires as the review says it, without the button beside it. */
function expiry(): string | null | undefined {
  return dialog().getByText("Expires", { selector: "dt" }).nextElementSibling?.querySelector("span")?.textContent;
}

/** Open the menu that changes the expiry, and press one of its entries. */
async function choose(entry: RegExp): Promise<void> {
  await act(async () => fireEvent.click(dialog().getByRole("button", { name: "Change when it expires" })));
  await waitFor(() => expect(within(document.body).queryAllByRole("menuitem", { name: "Never" }).length).toBe(1));
  await act(async () => fireEvent.click(within(document.body).getByRole("menuitem", { name: entry })));
}

function allowIsOff(): boolean {
  return dialog().getByRole("button", { name: "Approve" }).hasAttribute("disabled");
}

/** Type or paste into the field a person fills from the terminal. */
function type(code: string): void {
  fireEvent.change(dialog().getByRole("textbox", { name: "Code from your terminal" }), { target: { value: code } });
}

/** What a screen reader says after the name of the field of the code: the lines the field is described by. */
function saidAtField(): (string | null)[] {
  const lines = dialog().getByRole("textbox").getAttribute("aria-describedby")?.split(" ") ?? [];

  return lines.map((id) => document.getElementById(id)?.textContent ?? null);
}

/** Press Approve or Deny, and wait until the decision was answered: the buttons are off while it is on its way. */
async function decide(name: "Approve" | "Deny"): Promise<void> {
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
  setSystemTime();
  sent.length = 0;
});

describe("the review", () => {
  // Drift: the choice would start at what the login asked, so a stranger's login would be one press from everything; or a computer that asked to publish would be offered more.
  test.each([
    ["one that asked to publish is offered no choice", PUBLISHER, undefined, [], "Publisher (own sites only)", { scope: "publisher", expires: "never" }],
    ["one that asked for everything starts at its own sites only", ADMIN, undefined, ["Publisher: true", "Admin: false"], "Admin (everything)", { scope: "publisher", expires: "never" }],
    ["one that asked for everything gets it once Admin is pressed, for 30 days from when the review opened", ADMIN, "Admin", ["Publisher: true", "Admin: false"], "Admin (everything)", { scope: "admin", expires: after(30) }],
  ] as const)("%s", async (_case, login, press, starts, asks, approved) => {
    let closed = 0;
    setSystemTime(new Date(OPENED));
    render(<Reviewing login={login} onClose={() => (closed += 1)} />);
    const [began, asked] = [pressed(), fact("Asks for")];
    if (press !== undefined) fireEvent.click(dialog().getByRole("button", { name: press }));
    type(CODE);
    setSystemTime(new Date(OPENED + 10 * MINUTE_MS));
    await decide("Approve");

    expect([began, asked]).toEqual([starts, asks]);
    expect([sent, closed]).toEqual([[{ login: login.id, allow: true, code: CODE, ...approved }], 1]);
  });

  // Drift: keeping a computer out would ask for the code that only letting one in needs.
  test("denies with nothing typed", async () => {
    let closed = 0;
    render(<Reviewing login={ADMIN} onClose={() => (closed += 1)} />);
    await decide("Deny");

    expect([sent, closed]).toEqual([[{ login: ADMIN.id, allow: false }], 1]);
  });

  // Drift: Approve would be sent with a part of a code, which a guesser finds far sooner than the whole, or the page would say a part of a code again; or a paste would be refused for its dash, its small letters, or the spaces it brought.
  test.each([
    ["nothing", "", true],
    ["the last four letters", "MJHT", true],
    ["seven letters, a space, and a dash", "WDJB-MJ H", true],
    ["the code as the terminal shows it", "WDJB-MJHT", false],
    ["the code in small letters with no dash", "wdjbmjht", false],
    ["the code as a paste brings it, with spaces around it", "  WDJB-MJHT ", false],
    ["a code the page cannot know to be wrong", "BBBB-BBBB", false],
  ])("says no part of a code, and Approve is off until a whole code is typed or pasted: %s", (_case, code, off) => {
    render(<Reviewing login={PUBLISHER} />);
    const page = document.body.innerHTML.toUpperCase();
    if (code !== "") type(code);

    expect([CODE.split("-").filter((half) => page.includes(half)), allowIsOff(), sent]).toEqual([[], off, []]);
  });

  // Drift: a code the server refused would close the review as if done, or the refusal would show away from the field, or stay after the person typed again.
  // Or the line under the field, the note or the refusal, would be tied to nothing, so a screen reader would say the field's name alone.
  test("keeps open when the server refuses the code, says so at the field with the focus there, and takes the next try", async () => {
    let closed = 0;
    render(<Reviewing login={PUBLISHER} onClose={() => (closed += 1)} />);
    type("BBBB-BBBB");
    const before = saidAtField();
    await decide("Approve");
    const field = dialog().getByRole("textbox");
    const refused = [closed, dialog().getByRole("alert").textContent, document.activeElement === field, field.getAttribute("aria-invalid"), saidAtField()];
    type(CODE);
    const cleared = dialog().queryAllByRole("alert").length;
    sent.length = 0;
    await decide("Approve");

    expect([before, refused]).toEqual([["Type or paste it to approve."], [0, WRONG_CODE, true, "true", [WRONG_CODE]]]);
    expect([cleared, sent, closed]).toEqual([0, [{ login: PUBLISHER.id, allow: true, code: CODE, scope: "publisher", expires: "never" }], 1]);
  });
});

describe("the name a login gave itself", () => {
  // Drift: the name would be part of the title or of a button again, so a stranger would write the question an admin answers.
  test.each([
    ["a name that reads as the page's own words", "your session to continue", '"your session to continue"'],
    ["a name that reads as an order", "this login? Press Approve. Poplin support", '"this login? Press Approve. Poplin support"'],
    ["a name as long as a name may be", "w".repeat(100), `"${"w".repeat(100)}"`],
    ["a name with quotes of its own", 'laptop" Asks for: "Publisher', '"laptop" Asks for: "Publisher"'],
    ["no name", "", "None"],
  ])("is a quoted fact under its own label and nowhere else, for %s", (_case, computer, shown) => {
    render(<Reviewing login={{ ...ADMIN, computer }} />);
    const named = within(document.body).getByRole("dialog", { name: TITLE });
    const buttons = within(named)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    const outside = (named.textContent ?? "").replace(shown, "");

    expect([within(named).getByRole("heading").textContent, fact("Name it gave"), buttons]).toEqual([TITLE, shown, ["Publisher", "Admin", "Change when it expires", "Deny", "Approve", "Close"]]);
    expect(computer !== "" && outside.includes(computer)).toBe(false);
  });
});

describe("a review opened by a link", () => {
  // Drift: the words about links would be said to a person who pressed Review themselves, or left out for one a stranger's link brought here.
  test.each([
    ["by a press on the screen", false, false],
    ["by a link", true, true],
  ])("opened %s, it says who can send a link accordingly, and asks for the code either way", (_case, byLink, told) => {
    render(<Reviewing login={PUBLISHER} byLink={byLink} />);

    expect([dialog().queryByText(LINK_WORDS) !== null, dialog().queryAllByRole("textbox").length, allowIsOff()]).toEqual([told, 1, true]);
  });

  // Drift: any one of the three would fall away unseen, and the login a stranger sends an admin would again be one tick and one press from a token for everything.
  test("the login a stranger sends an admin meets all three: a title of the page's own, the least it may change, and an Approve that waits for a code the page does not show", () => {
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
      asks: "Admin (everything)",
      starts: ["Publisher: true", "Admin: false"],
      told: true,
      code: false,
      allowOff: true,
    });
  });
});

describe("when the token expires", () => {
  // Drift: an admin token would be approved with no end because the choice still stood at the publisher's, or a span picked by hand would be lost at the next press on a role.
  test("the expiry is the role's own, follows the role until one is picked by hand, and then stays as the menu wrote it", async () => {
    setSystemTime(new Date(OPENED));
    render(<Reviewing login={ADMIN} />);
    const starts = expiry();
    fireEvent.click(dialog().getByRole("button", { name: "Admin" }));
    const asAdmin = expiry();
    fireEvent.click(dialog().getByRole("button", { name: "Publisher" }));
    const back = expiry();
    await choose(/^90 days/);
    fireEvent.click(dialog().getByRole("button", { name: "Admin" }));
    const picked = expiry();
    type(CODE);
    setSystemTime(new Date(OPENED + 10 * MINUTE_MS));
    await decide("Approve");

    expect([starts, MOMENT.test(asAdmin ?? ""), back, MOMENT.test(picked ?? "")]).toEqual(["Never", true, "Never", true]);
    expect(sent).toEqual([{ login: ADMIN.id, allow: true, code: CODE, scope: "admin", expires: after(90) }]);
  });

  // Drift: an admin token with no end would be approved with nothing said of it, or the line would be said of a publisher token, which never had an end.
  test("an admin token set to never is told that it works until it is revoked, and a publisher token is told nothing", async () => {
    render(<Reviewing login={ADMIN} />);
    const told = (): number => dialog().queryAllByText("It works until you revoke it.").length;
    const asPublisher = told();
    fireEvent.click(dialog().getByRole("button", { name: "Admin" }));
    const dated = told();
    await choose(/^Never$/);
    const endless = told();
    type(CODE);
    await decide("Approve");

    expect([asPublisher, dated, endless]).toEqual([0, 0, 1]);
    expect(sent).toEqual([{ login: ADMIN.id, allow: true, code: CODE, scope: "admin", expires: "never" }]);
  });
});
