// The keys in a site's panel: Tab goes round its controls and never out to the page under it, and Escape is the key that leaves.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, test } from "./visit";

/** The screens the walk is taken on: a phone, where the panel takes the list's place, and the narrowest screen it lies over the list on. */
const SCREENS = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
] as const;

/** The sample site whose panel is opened, by its title. */
const SITE = "Pricing";

/** The first and the last control of the panel in the order of the keys. */
const ENDS = { first: "Edit", last: "Delete" } as const;

/** A button of the open panel, by its name. */
function inPanel(page: Page, name: string): Locator {
  return page.getByRole("dialog", { name: SITE, exact: true }).getByRole("button", { name, exact: true });
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, with the keys in a site's panel`, () => {
    test.use({ viewport: size });

    // Drift: Tab after the last control would leave the panel again, for a row under it or for the browser's own bar, and close it with no word; or Escape would leave the focus on the page itself.
    test("Tab after the panel's last control goes to its first, Shift+Tab goes back to the last, the panel stays open, and Escape closes it and goes to the row's button", async ({ page }) => {
      await arrive(page);
      const details = page.getByRole("button", { name: `Details of ${SITE}`, exact: true });

      await details.press("Enter");
      await inPanel(page, ENDS.last).focus();
      // The library moves the focus a frame after the key: the next key waits for it.
      await page.keyboard.press("Tab");
      await expect(inPanel(page, ENDS.first)).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(inPanel(page, ENDS.last)).toBeFocused();
      await expect(page.getByRole("dialog", { name: SITE, exact: true })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(details).toBeFocused();
    });
  });
}
