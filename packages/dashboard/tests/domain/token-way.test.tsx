// The way to a token: the one link to the provider's form, and the help behind its quiet line.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { TokenWay } from "@/domain/token-way";

/** What a token must hold, in an invented provider's words. */
const FORM = {
  tokenLabel: "Provider token",
  tokenRights: ["Records: Edit", "Routes: Edit"],
  tokenLink: "https://provider.example/tokens/new",
  tokenOptional: [{ right: "Rules: Edit", adds: "The provider stops floods first." }],
  tokenNote: "Choose what the token is for.",
};

afterEach(cleanup);
afterAll(clearPage);

describe("the way to a token", () => {
  // Drift: the link would take the typed values with it, or tell the provider where it came from.
  test("is one link that opens the provider's form in a new tab", () => {
    render(<TokenWay form={FORM} />);
    const link = within(document.body).getByText("Open the token form").closest("a") as HTMLAnchorElement;

    expect([link.href, link.target, link.rel]).toEqual(["https://provider.example/tokens/new", "_blank", "noreferrer"]);
  });

  // Drift: an address that is no https link would become a link all the same, and a press on it would run what the address holds.
  test.each(["javascript:alert(1)", "http://provider.example/tokens/new", "tokens/new", ""])("is no link for the address %p", (tokenLink) => {
    render(<TokenWay form={{ ...FORM, tokenLink }} />);

    expect([within(document.body).queryByText("Open the token form"), document.querySelectorAll("a").length]).toEqual([null, 0]);
  });

  // Drift: the rights would stand on the page at rest again, or the help would open on rights of the page's own invention.
  test("keeps every right behind its quiet line, which opens them in the provider's words", async () => {
    render(<TokenWay form={FORM} />);
    const page = within(document.body);
    const before = document.body.textContent?.includes("Records: Edit");
    await act(async () => {
      fireEvent.click(page.getByRole("button", { name: "Token help" }));
    });
    const help = page.getByRole("dialog").textContent;

    expect(before).toBe(false);
    expect(help).toContain("Add these 2 rights by hand:");
    expect(FORM.tokenRights.every((right) => help?.includes(right))).toBe(true);
    expect(help).toContain("Choose what the token is for.");
    expect(help).toContain("Rules: EditThe provider stops floods first.");
  });
});
