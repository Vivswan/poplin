// The choice of the look: what each press does to the button's name, to the page, and to what the browser keeps. The page of these tests asks for the light look.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";

import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeButton } from "@/shell/theme-button";

/** The key the look is kept under in these tests. */
const THEME_KEY = "test.theme";

/** Press the button, and say what it is named after, whether the page is dark, and what the browser keeps. */
function press(): readonly [string | null, boolean, string | null] {
  fireEvent.click(within(document.body).getByRole("button", { name: /^Theme: / }));

  return [within(document.body).getByRole("button", { name: /^Theme: / }).getAttribute("aria-label"), document.documentElement.classList.contains("dark"), localStorage.getItem(THEME_KEY)];
}

afterEach(cleanup);
afterAll(clearPage);

describe("the choice of the look", () => {
  // Drift: the button would flip between two looks again with no way back to the system's, would not say which look is chosen, or a choice would not turn the page or be kept.
  test("starts on the system's look, and each press moves on: Light, Dark, and System again", () => {
    render(
      <ThemeProvider storageKey={THEME_KEY}>
        <TooltipProvider>
          <ThemeButton />
        </TooltipProvider>
      </ThemeProvider>,
    );
    const first = within(document.body).getByRole("button", { name: /^Theme: / }).getAttribute("aria-label");

    expect([first, press(), press(), press()]).toEqual(["Theme: System", ["Theme: Light", false, "light"], ["Theme: Dark", true, "dark"], ["Theme: System", false, "system"]]);
  });
});
