// The form of the setup screen: what an empty box does, and where a refusal is said.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import type { Sent } from "@/domain/token-run";
import { Refused } from "@/lib/api";
import { SetupForm } from "@/setup/setup-form";

/** What a token must hold, in an invented provider's words. */
const FORM = {
  tokenRights: ["Records: Edit", "Routes: Edit"],
  tokenLink: "https://provider.example/tokens/new",
  tokenOptional: [],
  tokenNote: "Choose what the account token is for.",
};

/** The token the tests paste. */
const TOKEN = "planted-token-0123456789";

/** What the form was asked to repair with. */
const repairs: Sent[] = [];

/** Draw the form of one install over a repair that answers `refusal`, and hand back the page's queries. */
function drawn(boxes: "first" | "login", refusal?: Refused): Within {
  const onRepair = async (sent: Sent): Promise<Refused | undefined> => {
    repairs.push(sent);

    return refusal;
  };
  render(<SetupForm form={FORM} boxes={boxes} onRepair={onRepair} />);

  return within(document.body);
}

function box(page: Within, label: string): HTMLInputElement {
  return page.getByLabelText(label) as HTMLInputElement;
}

/** Fill every box of a new install and press Repair. */
async function repairFilled(page: Within): Promise<void> {
  fireEvent.change(box(page, "Domain"), { target: { value: "example.com" } });
  fireEvent.change(box(page, "Your email"), { target: { value: "mira@example.com" } });
  fireEvent.change(box(page, "Account token"), { target: { value: TOKEN } });
  await act(async () => {
    fireEvent.click(page.getByRole("button", { name: "Repair" }));
  });
}

afterEach(() => {
  cleanup();
  repairs.length = 0;
});
afterAll(clearPage);

describe("the boxes", () => {
  // Drift: an empty box would send a repair and take the pasted token with it.
  test("send nothing while the domain is empty, say so under it, and leave the pasted token", async () => {
    const page = drawn("first");
    fireEvent.change(box(page, "Account token"), { target: { value: TOKEN } });
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Repair" }));
    });
    const domain = box(page, "Domain");

    expect([repairs, box(page, "Account token").value, document.activeElement === domain]).toEqual([[], TOKEN, true]);
    expect(domain.closest('[data-slot="field"]')?.querySelector('[role="alert"]')?.textContent).toBe("Type the domain first.");
  });
});

describe("a refusal", () => {
  // Drift: a refusal would be said away from the box it is about, or the box to correct would not hold the focus.
  test.each([
    ["token", "Account token", "Account token refused: paste the whole account token, made for this account and this domain."],
    ["domain", "Domain", "Type a domain alone, such as example.com."],
    ["login", "Your email", "Type an email address, such as name@example.com."],
  ])("about %s is said at its box, which takes the focus", async (about, label, sentence) => {
    const page = drawn("first", new Refused({ code: "refused", about, sentence }));
    await repairFilled(page);
    const refused = box(page, label);

    expect([refused.getAttribute("aria-invalid"), document.activeElement === refused]).toEqual(["true", true]);
    expect(refused.closest('[data-slot="field"]')?.textContent).toContain(sentence);
  });

  // Drift: a refusal about no box, such as too many tries, would not be said at all, or the token would stay in its box after it was sent.
  test("about no box is said over the button; the typed domain and email stay and the token is gone", async () => {
    const page = drawn("first", new Refused({ code: "too_many_tries", about: null, sentence: "Too many tries. Wait a minute." }));
    await repairFilled(page);

    expect(page.getByRole("alert").textContent).toBe("Too many tries. Wait a minute.");
    expect(repairs).toEqual([{ token: TOKEN, domain: "example.com", login: "mira@example.com" }]);
    expect([box(page, "Domain").value, box(page, "Your email").value, box(page, "Account token").value]).toEqual(["example.com", "mira@example.com", ""]);
  });
});
