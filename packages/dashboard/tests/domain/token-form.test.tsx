// The token block: the box that holds a token only until its run is sent, where a refusal is said, and the way to a token.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { type Sent, TokenForm } from "@/domain/token-form";
import { Refused } from "@/lib/api";

/** What a token must hold, in an invented provider's words. */
const FORM = {
  tokenLabel: "Provider token",
  tokenRights: ["Records: Edit", "Routes: Edit"],
  tokenLink: "https://provider.example/tokens/new",
  tokenOptional: [{ right: "Rules: Edit", adds: "The provider stops floods first." }],
  tokenNote: "Choose what the token is for.",
};

/** The token the tests paste. */
const TOKEN = "planted-token-0123456789";

/** What the block was asked to run. */
const runs: { run: string; sent: Sent }[] = [];

/** Draw the block over a run that answers `refusal`, and hand back the page's queries. */
function drawn(refusal?: Refused, boxes?: "first" | "login", form = FORM) {
  const onRun = async (run: "check" | "repair", sent: Sent): Promise<Refused | undefined> => {
    runs.push({ run, sent });

    return refusal;
  };
  render(<TokenForm form={form} boxes={boxes} onRun={onRun} />);

  return within(document.body);
}

function box(page: ReturnType<typeof within>, label: string): HTMLInputElement {
  return page.getByLabelText(label) as HTMLInputElement;
}

async function press(page: ReturnType<typeof within>, name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(page.getByRole("button", { name }));
  });
}

afterEach(() => {
  cleanup();
  runs.length = 0;
});
afterAll(clearPage);

describe("the token's box", () => {
  // Drift: the token would show as typed, be offered by the browser again, or stay in the page after its run, where a glance or a later script finds it.
  test.each([
    ["a run that read its pieces", undefined],
    ["a refused token", new Refused({ code: "token", about: "token", sentence: "Token refused." })],
    ["a provider that did not answer", new Refused({ code: "unreachable", about: null, sentence: "No answer from the provider. Try again." })],
  ])("is a password box the browser does not fill, sent once and emptied after %s", async (_name, refusal) => {
    const page = drawn(refusal);
    const token = box(page, "Provider token");
    fireEvent.change(token, { target: { value: TOKEN } });
    await press(page, "Check");

    expect([token.type, token.autocomplete, token.required]).toEqual(["password", "off", true]);
    expect(runs).toEqual([{ run: "check", sent: { token: TOKEN } }]);
    expect([token.value, document.body.innerHTML.includes(TOKEN)]).toEqual(["", false]);
  });

  // Drift: the form's own send would check where the page says it repairs.
  test("repairs when its form is sent", async () => {
    const page = drawn();
    const token = box(page, "Provider token");
    fireEvent.change(token, { target: { value: TOKEN } });
    await act(async () => {
      fireEvent.submit(token.form as HTMLFormElement);
    });

    expect(runs).toEqual([{ run: "repair", sent: { token: TOKEN } }]);
  });

  // Drift: an empty box would send a run, take the pasted token with it, or be told by the browser's own bubble where every other refusal stands under its box.
  test.each([
    ["the token's", undefined, "Provider token", "Paste a token first.", ""],
    ["the domain's, with a token pasted", "first", "Domain", "Type the domain first.", TOKEN],
  ] as const)("sends nothing while %s box is empty, and says so under it", async (_name, boxes, label, sentence, pasted) => {
    const page = drawn(undefined, boxes);
    fireEvent.change(box(page, "Provider token"), { target: { value: pasted } });
    await press(page, "Check");
    await press(page, "Repair");
    const empty = box(page, label);

    expect([runs, (empty.form as HTMLFormElement).noValidate, box(page, "Provider token").value]).toEqual([[], true, pasted]);
    expect([
      empty.getAttribute("aria-invalid"),
      document.activeElement === empty,
      empty.closest('[data-slot="field"]')?.querySelector('[role="alert"]')?.textContent,
    ]).toEqual(["true", true, sentence]);
  });
});

describe("a refusal", () => {
  // Drift: a refusal would be said away from the box it is about, or the box to correct would not hold the focus.
  test.each([
    ["token", "Provider token", "Token refused."],
    ["domain", "Domain", "The domain is no domain."],
    ["login", "Your email", "The email is no email address."],
  ])("about %s is said at its box, which takes the focus", async (about, label, sentence) => {
    const page = drawn(new Refused({ code: "refused", about, sentence }), "first");
    fireEvent.change(box(page, "Domain"), { target: { value: "example.com" } });
    fireEvent.change(box(page, "Your email"), { target: { value: "mira@example.com" } });
    fireEvent.change(box(page, "Provider token"), { target: { value: TOKEN } });
    await press(page, "Repair");
    const refused = box(page, label);

    expect([refused.getAttribute("aria-invalid"), document.activeElement === refused]).toEqual(["true", true]);
    expect(refused.closest('[data-slot="field"]')?.textContent).toContain(sentence);
  });

  // Drift: a refusal about no box, such as too many tries, would not be said at all.
  test("about no box is said over the buttons, and the typed domain and email stay", async () => {
    const page = drawn(new Refused({ code: "too_many_tries", about: null, sentence: "Too many tries. Wait a minute." }), "first");
    fireEvent.change(box(page, "Domain"), { target: { value: "example.com" } });
    fireEvent.change(box(page, "Your email"), { target: { value: "mira@example.com" } });
    fireEvent.change(box(page, "Provider token"), { target: { value: TOKEN } });
    await press(page, "Repair");

    expect(page.getByRole("alert").textContent).toBe("Too many tries. Wait a minute.");
    expect(runs).toEqual([{ run: "repair", sent: { token: TOKEN, domain: "example.com", login: "mira@example.com" } }]);
    expect([box(page, "Domain").value, box(page, "Your email").value, box(page, "Provider token").value]).toEqual(["example.com", "mira@example.com", ""]);
  });
});

describe("the way to a token", () => {
  // Drift: the link would take the typed values with it, tell the provider where it came from, or the rights would be the page's own invention.
  test("is one link that opens the provider's form in a new tab", () => {
    const page = drawn();
    const link = page.getByText("Open the token form").closest("a") as HTMLAnchorElement;

    expect([link.href, link.target, link.rel]).toEqual(["https://provider.example/tokens/new", "_blank", "noreferrer"]);
    expect(document.body.textContent).toContain(
      "It opens in a new tab with the 2 rights chosen. Add nothing, and create the token. Choose what the token is for.",
    );
  });

  // Drift: an address that is no https link would become a link all the same, and a press on it would run what the address holds.
  test.each(["javascript:alert(1)", "http://provider.example/tokens/new", "tokens/new", ""])("is no link for the address %p", (tokenLink) => {
    const page = drawn(undefined, undefined, { ...FORM, tokenLink });

    expect([page.queryByText("Open the token form"), document.querySelectorAll("a").length]).toEqual([null, 0]);
  });

  // Drift: the optional rights would stand before the required boxes again, or their line would open on nothing.
  test("keeps the optional rights folded behind their own line, which opens them", async () => {
    const page = drawn();
    const fold = page.getByRole("button", { name: "Optional: block junk traffic and crawlers" });
    const folded = [fold.getAttribute("aria-expanded"), document.body.textContent?.includes("Rules: Edit The provider stops floods first.")];
    await act(async () => {
      fireEvent.click(fold);
    });

    expect(folded).toEqual(["false", false]);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Rules: Edit The provider stops floods first.");
    expect(document.body.textContent).toContain("Add any of them to the token on the form, then press Repair.");
  });

  // Drift: the form of an install nobody has logged in to would demand an email, or the one of a new install would let it be left out.
  test.each([
    ["first", ["Domain", "Your email"], [true, true]],
    ["login", ["Your email"], [false]],
  ] as const)("asks the boxes of %s beside the token", (boxes, labels, required) => {
    const page = drawn(undefined, boxes);

    expect(labels.map((label) => box(page, label).required)).toEqual([...required]);
    expect(page.queryByLabelText("Domain") === null).toBe(boxes === "login");
  });

  // Drift: on a set install the heading "Then paste it here" would stand over the email, which is only a correction.
  test.each([
    ["first", ["domain", "login", "token"]],
    ["login", ["token", "login"]],
  ] as const)("orders the boxes of %s with the token where its heading points", (boxes, names) => {
    drawn(undefined, boxes);

    expect([...document.querySelectorAll("input")].map((input) => input.name)).toEqual([...names]);
  });
});
