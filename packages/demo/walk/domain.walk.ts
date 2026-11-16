// The Domain screen of an install that holds what reads its provider: what it shows as it opens, when it checks again by itself, and that Check asks for nothing.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, said, test } from "./visit";

/** How far the reader's clock is moved on between two openings of the screen: past the 10 minutes a check is gone by. */
const PAST_FRESH = "11:00";

/** Go to a section by its entry at the side. A section whose screen holds a problem says how many after its name. */
async function toSection(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: new RegExp(`^${label}( \\d+ problems?)?$`) }).click();
}

/** The line at the top of the Domain screen, by what it says. */
function domainLine(page: Page, says: string): Locator {
  return page.getByRole("status").filter({ hasText: says });
}

// Drift: the install holds what reads its provider, so Domain would ask for a press and a token it has no use for, rest on a check from another day, or open the token's dialog at Check.
test("Domain opens on its pieces with no press and no token; opened again once the check is over ten minutes old it checks by itself, and Check asks for nothing", async ({ page }) => {
  await page.clock.install();
  await arrive(page);
  const asked = page.getByRole("dialog");
  await toSection(page, "Domain");
  await expect(domainLine(page, "Nothing to repair")).toBeVisible();
  await expect(page.getByRole("table", { name: "Pieces", exact: true }).getByRole("row").nth(1)).toBeVisible();
  await expect(asked).toHaveCount(0);

  await toSection(page, "Settings");
  await page.clock.fastForward(PAST_FRESH);
  await toSection(page, "Domain");
  await expect(domainLine(page, "2 to repair")).toBeVisible();
  await expect(asked).toHaveCount(0);

  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(said(page, "2 to repair.")).toBeVisible();
  await expect(asked).toHaveCount(0);
});
