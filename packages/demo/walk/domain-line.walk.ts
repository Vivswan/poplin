// The line over the pieces of the Domain screen and the problem drawn under it: the two say the same thing, before a repair and after it. And the count of a repair, which is the count that was to repair.

import { expect } from "@playwright/test";

import { arrive, said, test, toSection } from "./visit";

/** The sample install's problem of the domain, which says to press Repair. */
const ASKS_REPAIR = "A change of the users or the alerts did not take effect";

// Drift: every piece of the sample domain is in place, and a problem of the last day says "press Repair" right under the line.
// A line that counted the pieces alone would say "Nothing to repair" beside a green tick over a box that asks for a repair.
test("Domain's line counts a problem that says to press Repair and is drawn as work to do; once the repair is done the line is drawn as done and the problem is gone", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Domain");
  const line = page.getByRole("region", { name: "Domain", exact: true }).getByRole("status");
  const problem = page.getByRole("group", { name: ASKS_REPAIR, exact: true });

  await expect(problem).toContainText("Press Repair.");
  await expect(line).toContainText("1 to repair");
  await expect(line).toHaveAttribute("data-tone", "bad");

  const asked = page.getByRole("dialog", { name: "Repair the domain", exact: true });
  await page.getByRole("button", { name: "Repair", exact: true }).click();
  await asked.getByLabel("Account token", { exact: true }).fill("sample-token");
  await asked.getByRole("button", { name: "Repair", exact: true }).click();

  await expect(problem).toHaveCount(0);
  await expect(line).toHaveAttribute("data-tone", "good");
  await expect(line).not.toContainText("to repair");
});

// Drift: a check finds two pieces to repair beside the problem, and the line says "3 to repair". A repair that counted its pieces alone would say "2 repaired", and the problem would leave the screen with no word of it.
test("a repair says as many repaired as the line said to repair, and names the problem it ended where the problem stood", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Domain");
  const line = page.getByRole("region", { name: "Domain", exact: true }).getByRole("status");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(said(page, "3 to repair.")).toBeVisible();
  await expect(line).toContainText("3 to repair");

  const asked = page.getByRole("dialog", { name: "Repair the domain", exact: true });
  await page.getByRole("button", { name: "Repair", exact: true }).click();
  await asked.getByLabel("Account token", { exact: true }).fill("sample-token");
  await asked.getByRole("button", { name: "Repair", exact: true }).click();

  await expect(said(page, "3 repaired.")).toBeVisible();
  await expect(line).toContainText("3 repaired");
  await expect(page.getByRole("list", { name: "Repaired", exact: true }).getByRole("listitem")).toHaveText([`Repaired: ${ASKS_REPAIR}`]);
  await expect(page.getByRole("group", { name: ASKS_REPAIR, exact: true })).toHaveCount(0);

  // A check after it ended nothing: it names nothing as repaired.
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(said(page, "Nothing to repair.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Repaired", exact: true })).toHaveCount(0);
});
