// The email at the foot of the side menu: blurred where it rests, and sharp only under a pointer, with the focus the keys give it, or after a tap on a phone.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, test } from "./visit";

/** The screens the side menu is walked on: the widest, and the narrowest the Sites table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** How a blurred email is drawn. A sharp one has no filter. */
const BLURRED = /^blur\(/u;

/** The email that is in sight: the side menu's, or the one in a phone's sheet. Its hint holds it whole. */
function email(page: Page): Locator {
  return page.getByTitle(/@/u).filter({ visible: true });
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, the email at the foot of the side menu`, () => {
    test.use({ viewport: size });

    // Drift: the email would stand sharp on a shared screen again; or it would be blurred for good, with no way for a pointer or the keys to read it.
    test("is blurred where it rests, sharp under the pointer and with the focus of the keys, and blurred again after each", async ({ page }) => {
      await arrive(page);
      const shown = email(page);
      await expect(shown).toHaveCSS("filter", BLURRED);

      await shown.hover();
      await expect(shown).toHaveCSS("filter", "none");
      await page.mouse.move(size.width / 2, size.height / 2);
      await expect(shown).toHaveCSS("filter", BLURRED);

      // The keys reach it: one step back from it and one forward again is a focus the keys gave.
      await shown.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(shown).toBeFocused();
      await expect(shown).toHaveCSS("filter", "none");
      await page.keyboard.press("Shift+Tab");
      await expect(shown).toHaveCSS("filter", BLURRED);
    });
  });
}

test.describe("on a phone, the email at the foot of the sections", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  // Drift: a phone has no pointer to rest on the email: blurred with no tap that shows it, it could not be read there at all.
  test("is blurred where it rests, and sharp after a tap on it", async ({ page }) => {
    await arrive(page);
    await page.getByRole("button", { name: /^Sections/u }).click();
    const shown = email(page);
    await expect(shown).toHaveCSS("filter", BLURRED);

    await shown.tap();
    await expect(shown).toHaveCSS("filter", "none");
  });
});
