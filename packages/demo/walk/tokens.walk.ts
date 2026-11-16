// The Tokens tab of Access: the list of tokens keeps its columns when the removed tokens under it are opened.

import { expect, type Page } from "@playwright/test";

import { FIRST_LOAD_MS, test } from "./visit";

/** The screens the tables are walked on: the widest, and the narrowest a table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** Where each heading of the list of tokens starts, in whole pixels from the window's left edge. */
async function headingStarts(page: Page): Promise<readonly number[]> {
  const headings = page.getByRole("table", { name: "Tokens", exact: true }).getByRole("columnheader");

  return headings.evaluateAll((all) => all.map((heading) => Math.round(heading.getBoundingClientRect().left)));
}

/** The starts of the headings once they have come to rest: a table is measured again once the page's fonts are in, so the fonts are waited for, and then the headings are read until two reads agree. */
async function restedStarts(page: Page): Promise<readonly number[]> {
  await page.evaluate(async () => void (await document.fonts.ready));
  let last: readonly number[] = [];
  await expect(async () => {
    const before = last;
    last = await headingStarts(page);
    expect(last).toEqual(before);
  }).toPass();

  return last;
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, the list of tokens`, () => {
    test.use({ viewport: size });

    // Drift: the list would take the widths the removed tokens need, whose "How" says more than a state, and every column after it would jump to the right when they are opened.
    test("keeps every column where it is when the removed tokens under it are opened", async ({ page }) => {
      await page.goto("tokens/list");
      const removed = page.getByRole("table", { name: "Removed tokens", exact: true });
      // The rows drawn while the tokens are read have other widths: a token that works is waited for.
      await expect(page.getByRole("table", { name: "Tokens", exact: true }).getByText("Working", { exact: true }).first()).toBeVisible({ timeout: FIRST_LOAD_MS });
      const before = await restedStarts(page);

      await page.getByRole("button", { name: /^Removed tokens/ }).click();
      await expect(removed.getByRole("row").nth(1)).toBeVisible();
      // The removed tokens are measured after they are drawn, which is when the list above would move.
      await expect(async () => expect(await removed.evaluate((drawn) => drawn.scrollWidth - (drawn.closest('[data-slot="scroll-area"]')?.clientWidth ?? 0))).toBe(0)).toPass();

      expect([before.length > 3, await restedStarts(page)]).toEqual([true, before]);
    });
  });
}
