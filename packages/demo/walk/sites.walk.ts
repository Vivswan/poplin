// The Sites table: the buttons after each site's link stand on one edge down the column.

import { expect } from "@playwright/test";

import { arrive, test } from "./visit";

/** The screens the table is walked on: the widest, and the narrowest it fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, the Link column of the sites`, () => {
    test.use({ viewport: size });

    // Drift: the buttons would start where each row's link ends, and zigzag down the column, a row with no eye shifted again.
    test("has its Copy buttons on one edge, whatever a row's link is long and whether or not it has an eye", async ({ page }) => {
      await arrive(page);
      const table = page.getByRole("table", { name: "Sites", exact: true });
      const edges = (name: RegExp): Promise<number[]> => table.getByRole("button", { name }).evaluateAll((all) => all.map((button) => Math.round(button.getBoundingClientRect().right)));
      const [copies, eyes] = [await edges(/^Copy the link of /), await edges(/^(Show|Hide) link of /)];

      // The sample holds rows with an eye and rows with none: without both the one edge would prove nothing.
      expect([copies.length > eyes.length, eyes.length > 0, [...new Set(copies)].length]).toEqual([true, true, 1]);
    });
  });
}
