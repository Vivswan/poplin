// The form of the setup screen: what an empty box does, and where a refusal is said.

import { clearPage, type Within } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { type ReactNode, useState } from "react";

import type { Sent } from "@/domain/token-run";
import { Refused } from "@/lib/api";
import { SetupForm } from "@/setup/setup-form";
import type { Kind, Start } from "@/setup/setup-start";

/** What a token must hold, in an invented provider's words. */
const FORM = {
  tokenRights: ["Records: Edit", "Routes: Edit"],
  tokenLink: "https://provider.example/tokens/new",
  tokenOptional: [],
  tokenNote: "Choose what the account token is for.",
};

/** The same for an install without a domain. */
const NO_DOMAIN_FORM = { ...FORM, tokenRights: ["Login: Edit"], tokenNote: "Choose the account." };

/** The token the tests paste. */
const TOKEN = "planted-token-0123456789";

/** What the form was asked to repair with. */
const repairs: Sent[] = [];

/** The form with the kind of install held as the screen holds it. */
function Held({ start, onRepair }: { readonly start: Start; readonly onRepair: (sent: Sent) => Promise<Refused | undefined> }): ReactNode {
  const [kind, setKind] = useState<Kind>("domain");

  return <SetupForm start={start} kind={kind} onKind={setKind} onRepair={onRepair} />;
}

/** Draw the form of one install over a repair that answers `refusal`, and hand back the page's queries. */
function drawn(boxes: "first" | "login", refusal?: Refused): Within {
  const onRepair = async (sent: Sent): Promise<Refused | undefined> => {
    repairs.push(sent);

    return refusal;
  };
  render(<Held start={boxes === "login" ? { boxes, form: FORM } : { boxes, forms: { domain: FORM, "no-domain": NO_DOMAIN_FORM } }} onRepair={onRepair} />);

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

describe("the kind of install", () => {
  // Drift: a domain sent from the other kind's form would set the install up under it, and a missing choice would leave a person with no domain no way in.
  test("No domain shows the email and the token alone, with that kind's token form, and sends no domain", async () => {
    const page = drawn("first");
    fireEvent.change(box(page, "Domain"), { target: { value: "example.com" } });
    await act(async () => {
      fireEvent.click(page.getByRole("tab", { name: "No domain" }));
    });
    fireEvent.change(box(page, "Your email"), { target: { value: "mira@example.com" } });
    fireEvent.change(box(page, "Account token"), { target: { value: TOKEN } });
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Repair" }));
    });

    expect([page.queryByLabelText("Domain"), page.getByRole("heading", { name: /boxes/ }).textContent]).toEqual([null, "2Fill in two boxes"]);
    expect(repairs).toEqual([{ token: TOKEN, login: "mira@example.com" }]);

    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Account token help" }));
    });

    expect([page.queryByText("Choose the account.") !== null, page.queryByText("Login: Edit") !== null, page.queryByText("Records: Edit")]).toEqual([true, true, null]);
  });

  // Drift: an install nobody has logged in to has its kind already: asked again, the choice would do nothing.
  test("is not asked on an install nobody has logged in to", () => {
    expect(drawn("login").queryAllByRole("tab")).toEqual([]);
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

  // Drift: the UI library would check a box by a rule of the browser's, an email's form or a box that must be filled, and mark it as refused at Enter with no sentence under it, while the server's refusal stands at another box.
  test("marks no box the server did not refuse: an email typed wrong and a token typed and emptied stay unmarked at Enter", async () => {
    const page = drawn("login", new Refused({ code: "refused", about: "token", sentence: "Paste an account token first." }));
    fireEvent.change(box(page, "Account token"), { target: { value: "one" } });
    fireEvent.change(box(page, "Account token"), { target: { value: "" } });
    fireEvent.keyDown(box(page, "Account token"), { key: "Enter" });
    fireEvent.change(box(page, "Your email"), { target: { value: "wrong" } });
    fireEvent.keyDown(box(page, "Your email"), { key: "Enter" });
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Repair" }));
    });

    expect([box(page, "Account token").getAttribute("aria-invalid"), box(page, "Your email").getAttribute("aria-invalid"), page.getAllByRole("alert").length]).toEqual(["true", null, 1]);
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
