// The Settings screen under the wheel: its rows scroll, and the page around them never does.

import { expect, type Page } from "@playwright/test";

import { arrive, SECTIONS_BUTTON, screenHeading, test, toSection } from "./visit";

/** The screens Settings is walked on: the widest, and a phone. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** How far one turn of the wheel goes, in pixels, and how many turns reach the end of the longest list of rows. */
const [TURN, TURNS] = [400, 12] as const;

/** Turn the wheel down to the end with the pointer at a place of the window. */
async function wheelDown(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  for (let turn = 0; turn < TURNS; turn++) await page.mouse.wheel(0, TURN);
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, Settings`, () => {
    test.use({ viewport: size });

    // Drift: a part of a row that hangs on the page instead of on the row list makes the page taller than the window, and the wheel then slides the title bar and the side menu away, down to a blank screen on a phone.
    test("keeps its title bar and its way to the sections in place when the wheel is turned to the end", async ({ page }) => {
      await arrive(page);
      const sections = page.getByRole("button", { name: SECTIONS_BUTTON });
      const phone = await sections.isVisible();
      await toSection(page, "Settings");
      const rows = page.getByRole("form", { name: "Settings", exact: true }).locator("div").first();
      await expect(page.getByRole("heading", { name: "New sites", exact: true })).toBeVisible();

      // With the pointer over the rows, then over the side of the window, where a wide screen has its side menu.
      await wheelDown(page, size.width - 60, size.height / 2);
      await wheelDown(page, 20, size.height - 200);

      // The rows did move, so the wheel was turned over them: without that the checks below hold of a page that never scrolled at all.
      await expect.poll(() => rows.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight - window.innerHeight]), "how far the page went, and how far it could go").toEqual([0, 0]);
      await expect(screenHeading(page, "Settings")).toBeInViewport({ ratio: 1 });
      await expect(phone ? sections : page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: /^Sites/u })).toBeInViewport({ ratio: 1 });
    });
  });
}
