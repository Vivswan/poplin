// The steps only a person can do after a run.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";

import { PersonSteps } from "@/domain/person-steps";

afterEach(cleanup);
afterAll(clearPage);

// Drift: a step only a person can do would be said with no way to its address, or the address would be opened with the page's own address sent along.
test("each step is said with its address as a link that opens in a new tab", () => {
  render(<PersonSteps steps={[{ text: "The login is ready. Open your dashboard and log in:", address: "https://poplin.example.com" }]} />);
  const link = within(document.body).getByRole("link", { name: "https://poplin.example.com" }) as HTMLAnchorElement;

  expect([link.href, link.target, link.rel]).toEqual(["https://poplin.example.com/", "_blank", "noreferrer"]);
  expect(link.closest("li")?.textContent).toContain("The login is ready. Open your dashboard and log in:");
});
