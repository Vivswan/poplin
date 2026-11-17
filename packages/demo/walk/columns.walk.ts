// The columns of the Sites table by pointer and by keys: the first column keeps a width its edge can be reached at, and an arrow key moves a picked-up heading one place.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, test } from "./visit";

/** A screen wide enough for the table with every column of its start. */
const WIDE = { width: 1440, height: 900 } as const;

/** The table of sites. */
function sites(page: Page): Locator {
  return page.getByRole("table", { name: "Sites", exact: true });
}

/** The keys of the headings, in the order they are drawn. */
async function order(page: Page): Promise<readonly string[]> {
  return sites(page)
    .locator("th[data-column]")
    .evaluateAll((headings) => headings.map((heading) => heading.getAttribute("data-column") ?? ""));
}

/** The same order with one key moved by as many places. */
function moved(keys: readonly string[], key: string, by: number): readonly string[] {
  const from = keys.indexOf(key);
  const rest = keys.filter((each) => each !== key);

  return [...rest.slice(0, from + by), key, ...rest.slice(from + by)];
}

/** Drag from the middle of a part of the page sideways by as many pixels, in steps a drag is told by. */
async function drag(page: Page, from: Locator, by: number): Promise<void> {
  const box = await from.boundingBox();
  const [x, y] = [(box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by / 2, y, { steps: 4 });
  await page.mouse.move(x + by, y, { steps: 4 });
  await page.mouse.up();
}

test.describe("on a wide screen, the columns of the Sites table", () => {
  test.use({ viewport: WIDE });

  // Drift: the first column went down to 48 px, one letter of each name, and its edge, which lies inside it, came to lie under the heading's own button: no drag reached it, and only the Columns menu made the column wide again.
  test("the Site column dragged as narrow as it goes keeps room for a name, and its edge is still dragged wide again", async ({ page }) => {
    await arrive(page);
    const edge = sites(page).getByRole("separator", { name: "Resize the Site column", exact: true });
    const width = async (): Promise<number> => Number(await edge.getAttribute("aria-valuenow"));

    await drag(page, edge, -900);
    await expect(edge).toHaveAttribute("aria-valuenow", "120");
    // A drag that marked the page's text leaves the edge on marked text, and WebKit on Linux then drags that text in the edge's place.
    expect(await page.evaluate(() => String(document.getSelection()))).toBe("");
    await drag(page, edge, 100);

    await expect.poll(width).toBeGreaterThanOrEqual(215);
  });

  // Drift: the headings are of many widths and stay in place while one is moved, so one arrow key carried a heading two places to the left, and none to the right.
  test("an arrow key moves a picked-up heading one place, to the left and to the right, and nowhere past the last column", async ({ page }) => {
    await arrive(page);
    const start = await order(page);
    const [, second = "", third = ""] = start;
    const grip = (key: string): Locator => sites(page).locator(`th[data-column="${key}"]`).getByRole("button", { name: /^Move the /u });
    // The library hears the arrow keys a moment after a heading is picked up: its grip says when it is.
    const pickUp = async (key: string): Promise<void> => {
      await grip(key).focus();
      await page.keyboard.press("Space");
      await expect(grip(key)).toHaveAttribute("aria-pressed", "true");
      await page.evaluate(() => new Promise((heard) => setTimeout(heard, 50)));
    };

    await pickUp(third);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    await expect.poll(() => order(page)).toEqual(moved(start, third, -1));
    const afterLeft = await order(page);

    // The heading that was second is third now: one place to the left puts the start back.
    await pickUp(second);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    await expect.poll(() => order(page)).toEqual(start);

    const last = start.at(-1) ?? "";
    await pickUp(last);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await pickUp(second);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");
    await expect.poll(() => order(page)).toEqual(afterLeft);

    expect(start.length).toBeGreaterThanOrEqual(4);
  });
});
