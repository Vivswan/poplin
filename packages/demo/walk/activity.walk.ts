// The Activity table in its room: what its columns show whole, and where the room they leave over goes.

import { expect } from "@playwright/test";

import { arrive, screenHeading, test } from "./visit";

/** The screens the walk is taken on: the widest, with room to spare beside the columns, and the narrowest the table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, in the Activity table`, () => {
    test.use({ viewport: size });

    // Drift: a site's title would be cut by a few pixels again, with empty room beside its column: a link drawn wider than it is measured, in a column that stops at its measure.
    test("every site's title is whole, and the Site column ends where the last column begins", async ({ page }) => {
      await arrive(page);
      await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: "Activity", exact: true }).click();
      await expect(screenHeading(page, "Activity")).toBeVisible();
      const table = page.getByRole("table", { name: "Activity", exact: true });
      await expect(table.getByRole("row").nth(1)).toBeVisible();

      // Words are cut by a box that hides what it has no room for: a part that hides nothing has no width of its own to compare in every engine.
      const sites = table.locator("tbody td:nth-child(4)");
      const cut = (): Promise<(string | null)[]> =>
        sites.evaluateAll((cells) =>
          cells
            .flatMap((cell) => [cell, ...cell.querySelectorAll("*")])
            .filter((part) => getComputedStyle(part).overflowX !== "visible" && part.scrollWidth > part.clientWidth)
            .map((part) => part.textContent),
        );
      await expect.poll(cut).toEqual([]);
      // The control: the longest sample title is among them.
      await expect(sites.filter({ hasText: "Notes from the offsite" }).first()).toBeVisible();

      const heads = await table.getByRole("columnheader").evaluateAll((all) => all.map((head) => head.getBoundingClientRect()).map((box) => [Math.round(box.left), Math.round(box.right)]));
      expect(heads[3]?.[1]).toBe(heads.at(-1)?.[0]);
    });
  });
}
