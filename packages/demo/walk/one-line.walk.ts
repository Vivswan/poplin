// The lines that say a result, on a wide screen: one shows at a time, and a newer one takes the place of the one before it.

import { expect } from "@playwright/test";

import { arrive, siteNames, test, trash } from "./visit";

// Drift: a wide screen would stack a line for each result again, each over more of the header and of the controls under it, where a phone has shown the newest alone all along.
test("two sites deleted one after the other leave one line on a wide screen, the newer one's, with its Undo", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await arrive(page);
  const [first = "", second = ""] = await siteNames(page).allTextContents();
  const lines = page.getByRole("region", { name: /^Notifications/ }).getByRole("listitem");

  await trash(page, first);
  await trash(page, second);

  await expect(lines).toHaveCount(1);
  await expect(lines).toContainText(`${second} moved to the trash.`);
  await expect(lines.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
});
