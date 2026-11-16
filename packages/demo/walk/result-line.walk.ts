// A result said in a line with a button, about a site with a long title: on a wide screen the line stays inside the header, and still says what was done.

import { expect } from "@playwright/test";

import { arrive, openPanel, screenHeading, test } from "./visit";

/** The screens the walk is taken on: the widest, and the narrowest the Sites table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** The sample site that is given a long title, and the title. */
const SITE = { was: "Pricing", long: "Field notes of the northern team, part nine of the long winter survey and its many appendices" } as const;

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, a result with a button about a site with a long title`, () => {
    test.use({ viewport: size });

    // Drift: the words of the line would take as many rows as the title needs again, and the line would lie over the controls under the header for as long as it stays; or the title would be cut with what was done cut off behind it.
    test("lies inside the header, cuts the title alone, and shows its words whole as a hint", async ({ page }) => {
      await arrive(page);
      await openPanel(page, SITE.was);
      await page.getByRole("dialog", { name: SITE.was, exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
      const edit = page.getByRole("dialog", { name: /^Edit/u });
      await edit.getByRole("textbox", { name: "Title", exact: true }).fill(SITE.long);
      await edit.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("dialog", { name: SITE.long, exact: true }).getByRole("button", { name: "Delete", exact: true }).click();

      const whole = `${SITE.long} moved to the trash.`;
      const words = page.getByTitle(whole, { exact: true });
      await expect(words).toBeVisible();
      const line = page.locator("[data-sonner-toast]").filter({ has: words });
      const header = page.locator("header").filter({ has: screenHeading(page, "Sites") });
      // The line slides into its place: its place counts once two frames read it alike.
      await expect(async () => {
        const before = await line.boundingBox();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        const [band, box] = await Promise.all([header.boundingBox(), line.boundingBox()]);

        expect(box).toEqual(before);
        expect(box?.y).toBeGreaterThanOrEqual(band?.y ?? Number.NaN);
        expect((box?.y ?? Number.NaN) + (box?.height ?? Number.NaN)).toBeLessThanOrEqual((band?.y ?? Number.NaN) + (band?.height ?? Number.NaN));
      }).toPass();

      // Each part with what it says, and whether it has less room than its words need.
      const parts = await words.locator("span").evaluateAll((all) => all.map((part) => [part.textContent, part.scrollWidth > part.clientWidth]));
      expect(parts).toEqual([
        [SITE.long, true],
        [" moved to the trash.", false],
      ]);
    });
  });
}
