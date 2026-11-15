// The review of a waiting login: where its code stands, what Allow sends without the tick, and when the choice of less is offered.

import { clearPage } from "../lib/support/page";

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
  code: "WDJB-MJHT",
  scope: "publisher",
  computer: "studio-laptop",
  asked: 1_794_700_000_000,
  expires: 1_794_700_600_000,
} as Review;

/** A login that asked for everything. */
const ADMIN = { ...PUBLISHER, id: "0cbb997f737c56ae", scope: "admin", computer: "build-server" } as Review;

/** What the server says when Allow comes without the tick. */
const NOT_TICKED = "Tick the box first.";

/** Every decision the dialog sent. */
const sent: Parameters<AccessActions["decide"]>[1][] = [];

/** The changes of the screen, with a decision that answers as the server does: no tick, no login. */
const ACTIONS = {
  decide: async (_login: Review, decision: Parameters<AccessActions["decide"]>[1]): Promise<Decided> => {
    sent.push(decision);

    return decision.allow && !decision.confirm ? { kind: "box", sentence: NOT_TICKED } : { kind: "done" };
  },
} as AccessActions;

/** Draw the review of a login as the screen does: under the client that sends its changes. */
function Reviewing({ login, onClose }: { readonly login: Review; readonly onClose: () => void }): ReactNode {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ReviewDialog login={login} actions={ACTIONS} onClose={onClose} />
    </QueryClientProvider>
  );
}

function dialog(): ReturnType<typeof within> {
  return within(within(document.body).getByRole("dialog"));
}

/** Press Allow or Deny, and wait until the decision was answered: the buttons are off while it is on its way. */
async function decide(name: "Allow" | "Deny"): Promise<void> {
  fireEvent.click(dialog().getByRole("button", { name }));
  await waitFor(() => expect(dialog().getByRole("button", { name }).hasAttribute("disabled")).toBe(false));
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
  // Drift: Allow without the tick would close the review as if done, or the refusal would show away from the box.
  test("keeps open when Allow comes without the tick, says the refusal at the box, and puts the focus there", async () => {
    let closed = 0;
    render(<Reviewing login={PUBLISHER} onClose={() => (closed += 1)} />);
    await decide("Allow");
    const box = dialog().getByRole("checkbox");

    expect(sent).toEqual([{ allow: true, confirm: false, scope: "publisher" }]);
    expect([closed, dialog().getByRole("alert").textContent, document.activeElement === box]).toEqual([0, NOT_TICKED, true]);
  });

  // Drift: a computer that asked to publish would be offered everything, or one that asked for everything could not be given less.
  test.each([
    ["one that asked to publish", PUBLISHER, 0, "publisher"],
    ["one that asked for everything", ADMIN, 2, "publisher"],
  ] as const)("offers the choice of less only to %s", async (_case, login, choices, scope) => {
    let closed = 0;
    render(<Reviewing login={login} onClose={() => (closed += 1)} />);
    const offered = dialog().queryAllByRole("button", { name: /^(Everything|Own sites only)$/ });
    if (choices > 0) fireEvent.click(dialog().getByRole("button", { name: "Own sites only" }));
    fireEvent.click(dialog().getByRole("checkbox"));
    await decide("Allow");

    expect(offered).toHaveLength(choices);
    expect([sent, closed]).toEqual([[{ allow: true, confirm: true, scope }], 1]);
  });

  // Drift: keeping a computer out would ask for the tick that only letting one in needs.
  test("denies without the tick", async () => {
    let closed = 0;
    render(<Reviewing login={ADMIN} onClose={() => (closed += 1)} />);
    await decide("Deny");

    expect([sent, closed]).toEqual([[{ allow: false, confirm: false, scope: "admin" }], 1]);
  });
});
