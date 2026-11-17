// The Domain screen of an install that holds what reads its provider: what it shows as it opens, when it checks again by itself, and that Check asks for nothing. And a problem a repair mends, which leaves once the repair is done.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, said, screenHeading, test, toSection } from "./visit";

/** How far the reader's clock is moved on between two openings of the screen: past the 10 minutes a check is gone by. */
const PAST_FRESH = "11:00";

/** The sample install's problem of the domain, which a repair mends: what it says. */
const MENDED_BY_REPAIR = "A change of the users did not reach the login page";

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
  await expect(domainLine(page, "1 to repair")).toBeVisible();
  await expect(page.getByRole("table", { name: "Pieces", exact: true }).getByRole("row").nth(1)).toBeVisible();
  await expect(asked).toHaveCount(0);

  await toSection(page, "Settings");
  // Domain stays drawn until the code of Settings has loaded. A press on Domain before that opens nothing again.
  await expect(screenHeading(page, "Settings")).toBeVisible();
  await page.clock.fastForward(PAST_FRESH);
  await toSection(page, "Domain");
  await expect(domainLine(page, "2 to repair")).toBeVisible();
  await expect(asked).toHaveCount(0);

  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(said(page, "2 to repair.")).toBeVisible();
  await expect(asked).toHaveCount(0);
});

// Drift: a problem that says "press Repair" would stay on the screen and at the side for a day after the repair was done, asking for what a person just did; or a check, which mends nothing of it, would take it away.
test("a problem a repair mends stays through a check, and leaves the Domain screen and the side once the repair is done", async ({ page }) => {
  await arrive(page);
  const sections = page.getByRole("navigation", { name: "Sections", exact: true });
  const problem = page.getByRole("group", { name: MENDED_BY_REPAIR, exact: true });
  await toSection(page, "Domain");
  await expect(problem).toBeVisible();

  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(said(page, "2 to repair.")).toBeVisible();
  // The side counts what the check left to do beside the problem: once it says two, the screen holds what was read after the check.
  await expect(sections.getByRole("link", { name: "Domain 2 problems", exact: true })).toBeVisible();
  await expect(problem).toBeVisible();

  const asked = page.getByRole("dialog", { name: "Repair the domain", exact: true });
  await page.getByRole("button", { name: "Repair", exact: true }).click();
  await asked.getByLabel("Account token", { exact: true }).fill("sample-token");
  await asked.getByRole("button", { name: "Repair", exact: true }).click();

  await expect(problem).toHaveCount(0);
  await expect(sections.getByRole("link", { name: "Domain", exact: true })).toBeVisible();
});
