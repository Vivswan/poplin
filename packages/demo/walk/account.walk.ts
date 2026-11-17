// The account's menu at the foot of the side menu: the email is its button, and Sign out is its one item.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, SECTIONS_BUTTON, test } from "./visit";

/** What the demo says where the product ends the browser's login: the demo has none to end. */
const SIGNED_OUT = "Demo. Here the product ends this browser's login. The demo has no login, so nothing was ended.";

/** The button the email is, where it is in sight: the side menu's, or the one in a phone's sheet. */
function account(page: Page): Locator {
  return page.getByRole("button", { name: /@example\.com$/u }).filter({ visible: true });
}

/** The one item of the account's menu. */
function signOut(page: Page): Locator {
  return page.getByRole("menu").getByRole("menuitem", { name: "Sign out", exact: true });
}

// Drift: Sign out would stand as a loose word beside the email again, where it reads as part of the address; or the menu would open with no key, keep the focus after Escape, or lead to a page headed "403", which reads as a failure.
test("the email opens a menu with Enter, Escape closes it and leaves the focus on the email, and Sign out in it leaves the dashboard for a page headed Signed out", async ({ page }) => {
  await arrive(page);
  await expect(page.getByText("Sign out", { exact: true })).toHaveCount(0);

  await account(page).focus();
  await page.keyboard.press("Enter");
  await expect(signOut(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(account(page)).toBeFocused();

  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await expect(signOut(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Signed out", exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText(SIGNED_OUT);
  // The way back is on the page.
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(account(page)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  // Drift: a phone keeps the side menu in a sheet. A menu that opened under the sheet, or outside the screen, would leave a phone with no way out of its login.
  test("the email in the sections opens the same menu over it, and a tap on Sign out leaves the dashboard", async ({ page }) => {
    await arrive(page);
    await page.getByRole("button", { name: SECTIONS_BUTTON }).click();
    await account(page).tap();
    // The menu grows into its place as it opens: it is measured until it has come to rest.
    await expect(async () => {
      const [item, button] = await Promise.all([signOut(page).boundingBox(), account(page).boundingBox()]);

      expect((item?.y ?? Number.NaN) + (item?.height ?? Number.NaN)).toBeLessThanOrEqual(button?.y ?? Number.NaN);
      expect(item?.x).toBeGreaterThanOrEqual(0);
    }).toPass();

    await signOut(page).tap();
    await expect(page.locator("body")).toContainText(SIGNED_OUT);
  });
});
