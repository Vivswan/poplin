// The line over the pieces of the Domain screen and the problem drawn under it: the two say the same thing, before a repair and after it.

import { expect } from "@playwright/test";

import { arrive, test, toSection } from "./visit";

/** The sample install's problem of the domain, which says to press Repair. */
const ASKS_REPAIR = "A change of the users did not reach the login page";

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
