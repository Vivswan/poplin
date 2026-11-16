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

/** How often Tab is pressed with no wait between two presses: more than twice round the panel's controls. */
const FAST_TABS = 40;

/** A button of the open panel, by its name. */
function inPanel(page: Page, name: string): Locator {
  return page.getByRole("dialog", { name: SITE, exact: true }).getByRole("button", { name, exact: true });
}

/** Note every place outside the open panel that takes the focus from now on, by its words, in a list of the page's own. The panel's own part of the page also holds the stops the library turns the focus round at. */
async function noteFocusOutside(page: Page): Promise<void> {
  await page.getByRole("complementary", { name: SITE, exact: true }).evaluate((panel) => {
    const outside: string[] = [];
    Object.assign(window, { outside });
    document.addEventListener("focusin", ({ target }) => {
      if (target instanceof HTMLElement && !panel.contains(target)) outside.push(target.textContent.trim() || target.tagName);
    });
  });
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

    // Drift: Tab pressed faster than the library moves the focus would pass the panel's last control and go to the page under it, to its skip link and its sections, before it comes back.
    test("Tab pressed many times with no wait never puts the focus outside the panel", async ({ page }) => {
      await arrive(page);
      await page.getByRole("button", { name: `Details of ${SITE}`, exact: true }).press("Enter");
      await expect(page.getByRole("dialog", { name: SITE, exact: true }).getByRole("heading", { name: SITE, exact: true })).toBeFocused();
      await noteFocusOutside(page);

      for (let press = 0; press < FAST_TABS; press += 1) await page.keyboard.press("Tab");

      expect(await page.evaluate(() => (window as unknown as { outside: string[] }).outside), "the places outside the panel that took the focus").toEqual([]);
      await expect(page.getByRole("dialog", { name: SITE, exact: true })).toBeVisible();
      // The last Tab may rest on one of the library's stops for a frame: the focus is waited for.
      await expect(page.getByRole("dialog", { name: SITE, exact: true }).locator(":focus")).toHaveCount(1);
    });
  });
}
