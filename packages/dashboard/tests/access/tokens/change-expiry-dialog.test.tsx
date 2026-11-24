// The dialog that changes a token's expiry: what it starts at, what Save sends, what a day of the calendar comes to, and where a refusal is said.

import { clearPage, type Within } from "../../lib/support/page";

import { afterAll, afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

import type { AccessActions } from "@/access/access-actions";
import type { Token } from "@/access/access-queries";
import { ChangeExpiryDialog } from "@/access/tokens/change-expiry-dialog";
import type { Expiry } from "@/dialog/expiry/expiry-moments";
import { momentIn } from "@/lib/timezone";

/** A day in milliseconds. */
const DAY_MS = 86_400_000;

/** A minute in milliseconds. */
const MINUTE_MS = 60_000;

/** The moment a menu opens at, in the test that moves the clock. */
const OPENED = Date.UTC(2031, 4, 6, 12, 0, 0);

/** How a moment is written: the day with two figures, and the time to the minute. */
const MOMENT = String.raw`\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}`;

/** A publisher token that never expires, and an admin token that does ten days after the moment the clock is moved to. */
const PUBLISHER = { id: "cd45ee5db1827382", scope: "publisher", note: "report agent", created: 1_794_000_000_000, expires: "never" } as Token;
const ADMIN = { id: "0cbb997f737c56ae", scope: "admin", note: "studio-laptop", created: 1_794_000_000_000, expires: OPENED + 10 * DAY_MS } as Token;

/** What the server refuses a moment that has passed with. */
const REFUSAL = "Pick a day that is still ahead.";

/** What the dialog asked for, how often it closed, whether the server refuses, and what its answer waits for. */
const asked: { changes: (readonly [token: string, expires: Expiry])[]; closed: number; refuses: boolean; held: Promise<void> | undefined } = { changes: [], closed: 0, refuses: false, held: undefined };

/** The changes of the screen, of which the dialog changes an expiry. */
const ACTIONS = {
  changeExpiry: async (token: Token, expires: Expiry) => {
    asked.changes.push([token.id, expires]);
    await asked.held;

    return asked.refuses ? REFUSAL : undefined;
  },
} as unknown as AccessActions;

function drawn(token: Token): Within {
  render(<ChangeExpiryDialog token={token} actions={ACTIONS} onClose={() => (asked.closed += 1)} />);

  return within(within(document.body).getByRole("dialog", { name: "Change expiry" }));
}

/** When the token expires as the dialog says it, without the button beside it. */
function expiry(dialog: Within): string | null | undefined {
  return dialog.getByText("Expires", { selector: "dt" }).nextElementSibling?.querySelector("span")?.textContent;
}

/** Open the menu that changes the expiry, and press one of its entries. */
async function choose(dialog: Within, entry: RegExp | string): Promise<void> {
  await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Change when it expires" })));
  await waitFor(() => expect(within(document.body).queryAllByRole("menuitem", { name: "Never" }).length).toBe(1));
  await act(async () => fireEvent.click(within(document.body).getByRole("menuitem", { name: entry })));
}

/** Press Save, and let the dialog take in what the server answers. */
async function save(dialog: Within): Promise<void> {
  await act(async () => {
    fireEvent.click(dialog.getByRole("button", { name: "Save" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function saveIsOff(dialog: Within): boolean {
  return dialog.getByRole("button", { name: "Save" }).hasAttribute("disabled");
}

/** Hold every answer of the server until the returned function is called, and let the dialog take the answers in then. */
function heldAnswers(): () => Promise<void> {
  const answer = Promise.withResolvers<void>();
  asked.held = answer.promise;

  return () =>
    act(async () => {
      answer.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

afterEach(() => {
  cleanup();
  setSystemTime();
  Object.assign(asked, { changes: [], closed: 0, refuses: false, held: undefined });
});
afterAll(clearPage);

describe("the dialog that changes a token's expiry", () => {
  // Drift: Save would send the moment the token has, or a span counted from another moment than the one the menu wrote; or a publisher token could get no day, and an admin token no "never".
  test.each([
    ["a publisher token that never expires gets 90 days, counted from when the menu opened and not from the Save ten minutes later", PUBLISHER, /^90 days/, "Never", OPENED + 90 * DAY_MS, 0],
    ["an admin token with a day is set to never, and told what that means", ADMIN, "Never", undefined, "never", 1],
  ] as const)("%s", async (_case, token, entry, starts, lasts, told) => {
    setSystemTime(new Date(OPENED));
    const dialog = drawn(token);
    const before = [expiry(dialog), saveIsOff(dialog)];
    await choose(dialog, entry);
    const after = [saveIsOff(dialog), dialog.queryAllByText("It works until you revoke it.").length];
    setSystemTime(new Date(OPENED + 10 * MINUTE_MS));
    await save(dialog);

    expect(before).toEqual([starts ?? expect.stringMatching(new RegExp(`^${MOMENT}$`)), true]);
    expect(after).toEqual([false, told]);
    expect([asked.changes, asked.closed]).toEqual([[[token.id, lasts]], 1]);
  });

  // Drift: the choices of a token would be the ones of a site, whose longest span is 30 days, or lose the year or never.
  test("the choices are 30 days, 90 days, 1 year, a day of the calendar, and never, each span with the moment it ends", async () => {
    const dialog = drawn(ADMIN);
    await act(async () => fireEvent.click(dialog.getByRole("button", { name: "Change when it expires" })));
    const entries = (await within(document.body).findAllByRole("menuitem")).map((entry) => (entry.textContent ?? "").replace(new RegExp(MOMENT), " <moment>"));

    expect(entries).toEqual(["30 days <moment>", "90 days <moment>", "1 year <moment>", "On a day...", "Never"]);
  });

  // Drift: a day of the calendar would end the token at another moment than the one the calendar wrote, or the calendar would say of a token what is true of a site.
  test("a day of the calendar is the moment that day starts, said in the words of a token", async () => {
    const dialog = drawn(PUBLISHER);
    await choose(dialog, "On a day...");
    const calendar = within(await within(document.body).findByRole("dialog", { name: "Pick a day" }));
    const says = calendar.queryAllByText("The token stops working when that day starts. To end it now, revoke it.").length;
    const day = calendar.getAllByRole("button").find((button) => button.closest("td") !== null && !button.hasAttribute("disabled"));
    await act(async () => fireEvent.click(day as HTMLElement));
    const written = calendar.getByText(/^Expires /).textContent?.replace("Expires ", "");
    await act(async () => {
      fireEvent.click(calendar.getByRole("button", { name: "Pick" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const shown = expiry(dialog);
    await save(dialog);
    const [[, sent] = []] = asked.changes;

    const start = new Date(typeof sent === "number" ? sent : Number.NaN);

    expect([says, /, 00:00$/.test(written ?? ""), shown]).toEqual([1, true, written]);
    // What Save sends is the very moment the calendar wrote: the start of the picked day, to the millisecond.
    expect([momentIn(start.getTime()), [start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()], asked.closed]).toEqual([written, [0, 0, 0, 0], 1]);
  });

  // Drift: a refused moment would close the dialog as if saved, or the refusal would stay beside a moment chosen after it.
  test("a refused moment is said in the dialog, which stays open, and leaves with the next choice", async () => {
    asked.refuses = true;
    const dialog = drawn(PUBLISHER);
    await choose(dialog, /^30 days/);
    await save(dialog);
    const refused = [dialog.queryAllByRole("alert").map((alert) => alert.textContent), asked.closed];
    await choose(dialog, /^90 days/);

    expect([refused, dialog.queryAllByRole("alert").length]).toEqual([[[REFUSAL], 0], 0]);
  });

  // Drift: a refusal that came in late stood beside a moment chosen while it was on its way, which nobody sent.
  test("a refusal that comes in after another moment was chosen is not said of that moment", async () => {
    asked.refuses = true;
    const answer = heldAnswers();
    const dialog = drawn(PUBLISHER);
    await choose(dialog, /^30 days/);
    await save(dialog);
    await choose(dialog, /^90 days/);
    await answer();

    expect([asked.changes.length, dialog.queryAllByRole("alert").length, asked.closed]).toEqual([1, 0, 0]);
  });

  // Drift: a Save answered late closed the dialog of another token, opened after the first was left.
  test("a Save answered after its dialog was left for another token does not close that one", async () => {
    const answer = heldAnswers();
    const shown = (token: Token): ReactNode => <ChangeExpiryDialog token={token} actions={ACTIONS} onClose={() => (asked.closed += 1)} />;
    const view = render(shown(PUBLISHER));
    const dialog = within(within(document.body).getByRole("dialog", { name: "Change expiry" }));
    await choose(dialog, /^30 days/);
    await save(dialog);
    view.rerender(shown(ADMIN));
    await answer();

    expect([asked.changes.map(([id]) => id), asked.closed]).toEqual([[PUBLISHER.id], 0]);
  });
});
