// The Usage table: where the icons at a row's end stand, and what a day's line is called once the reader's date is another than the UTC day of its number.

import { expect } from "@playwright/test";

import { arrive, screenHeading, test } from "./visit";

/** The screens the walk is taken on: the widest, and the narrowest the table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** Three days in milliseconds: further than any time zone is from UTC. */
const THREE_DAYS_MS = 259_200_000;

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, in the Usage table`, () => {
    test.use({ viewport: size });

    // Drift: the two kinds of icon would stand in a column each again, so a row with one of them ends short of the row with the other, and the icons read as indented against each other.
    test("the last icon of every row ends at one right edge, and a row with both has the host's page before the setting", async ({ page }) => {
      await arrive(page);
      await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: /^Usage/u }).click();
      await expect(screenHeading(page, "Usage")).toBeVisible();
      const table = page.getByRole("table", { name: "Usage", exact: true });
      await expect(table.getByRole("row").nth(1)).toBeVisible();

      const rows = await table.locator("tbody tr").evaluateAll((all) =>
        all
          .map((row) => [...row.querySelectorAll("td:last-child a")].map((icon) => ({ name: icon.getAttribute("aria-label") ?? "", box: icon.getBoundingClientRect() })))
          .filter((icons) => icons.length > 0)
          .map((icons) => ({ kinds: icons.map((icon) => (icon.name.startsWith("Change the limit") ? "setting" : "host")), end: icons.at(-1)?.box.right, sizes: icons.map((icon) => `${icon.box.width}x${icon.box.height}`) })),
      );
      // The control: a row with both icons, a row with the setting alone, and a row with the host's page alone are all there.
      expect([...new Set(rows.map((row) => row.kinds.join(" ")))].sort()).toEqual(["host", "host setting", "setting"]);
      expect({ ends: new Set(rows.map((row) => row.end)).size, sizes: new Set(rows.flatMap((row) => row.sizes)).size }).toEqual({ ends: 1, sizes: 1 });
    });
  });
}

// Drift: a day's number is of a UTC day; called "today" on a reader's other date, it reads as the number of a day it is not of.
test("with the reader's clock three days on, a day's line names the UTC day of its number in place of today", async ({ page }) => {
  await page.clock.setFixedTime(Date.now() + THREE_DAYS_MS);
  await arrive(page);
  await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: /^Usage/u }).click();
  const names = page.getByRole("table", { name: "Usage", exact: true }).locator("tbody td:first-child");
  await expect(names.first()).toBeVisible();

  const days = (await names.allTextContents()).filter((name) => name.startsWith("Requests") || name.startsWith("Database rows"));
  expect(days.map((name) => name.replace(/\d{2} [A-Z][a-z]{2}/u, "DD Mon"))).toEqual(["Requests on DD Mon UTC", "Database rows read on DD Mon UTC", "Database rows written on DD Mon UTC"]);
});
