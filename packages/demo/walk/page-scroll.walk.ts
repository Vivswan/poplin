// The screens whose tables are short, Domain and Access: the page under the heading is the one thing that scrolls up and down, with its bar at the window's edge, and no table or list has a bar of its own.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, onPage, test, toSection } from "./visit";

/** The windows the screens are walked in: one of a usual height, one too short for any of the screens, and a phone as short. */
const WINDOWS = [
  { width: 1440, height: 700 },
  { width: 1440, height: 300 },
  { width: 390, height: 300 },
] as const;

/** The windows too short to hold a whole screen: there the page must be what scrolls. */
const SHORT = 300;

/** The rows of a list by its name: those of the table a wide window shows, or of the list a phone shows. */
function rowsOf(page: Page, name: string): Locator {
  return page.locator(`table[aria-label="${name}"]:visible tbody tr, ul[aria-label="${name}"]:visible li`);
}

/** The screens walked, each by how it is reached from the Sites screen, and whether the sample data fills it past a short window: the sample install has two users, whose list fits any window. */
const SCREENS: readonly (readonly [string, (page: Page) => Promise<void>, boolean])[] = [
  [
    "Domain",
    async (page) => {
      await toSection(page, "Domain");
      await expect(rowsOf(page, "Pieces").last()).toBeVisible();
    },
    true,
  ],
  [
    "Users",
    async (page) => {
      await toSection(page, "Access");
      await expect(rowsOf(page, "Users").last()).toBeVisible();
    },
    false,
  ],
  [
    "Tokens with the removed ones open",
    async (page) => {
      await toSection(page, "Access");
      await onPage(page, "tab", { name: "Tokens", exact: true }).click();
      await onPage(page, "button", { name: /^Revoked tokens/ }).click();
      await expect(rowsOf(page, "Revoked tokens").last()).toBeVisible();
    },
    true,
  ],
];

/** What scrolls up and down in the screen's part of the window: each such part by its name, and whether it is the page. A part scrolls where it is set to and holds more than it shows. */
async function scrollers(page: Page): Promise<readonly { readonly name: string; readonly page: boolean; readonly atEdge: boolean }[]> {
  return page.locator("main").evaluate((main) =>
    [...main.querySelectorAll<HTMLElement>("*")]
      .filter((part) => ["auto", "scroll"].includes(getComputedStyle(part).overflowY) && part.scrollHeight > part.clientHeight + 1)
      .map((part) => ({
        name: part.dataset.slot ?? part.getAttribute("aria-label") ?? part.tagName,
        page: part.dataset.slot === "screen-page",
        atEdge: Math.round(part.getBoundingClientRect().right) === window.innerWidth,
      })),
  );
}

for (const size of WINDOWS) {
  test.describe(`in a window ${size.width} by ${size.height}`, () => {
    test.use({ viewport: size });

    for (const [name, open, long] of SCREENS) {
      // Drift: a table would again stand in a room of its own height, with a bar at its own right edge in the middle of the window, while the rest of the screen stood still.
      test(`${name}: nothing but the page scrolls up and down, and in a short window the page does, to its last row`, async ({ page }) => {
        await arrive(page);
        await open(page);
        const all = await scrollers(page);

        expect(
          all.filter((part) => !part.page),
          "the parts of the screen that scroll up and down beside the page",
        ).toEqual([]);
        if (size.height > SHORT || !long) return;

        expect(all, "the page scrolls, with its bar at the window's edge").toEqual([{ name: "screen-page", page: true, atEdge: true }]);
        const last = page.locator("main").locator("tr:visible, li:visible").last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport({ ratio: 1 });
        expect(await page.evaluate(() => document.scrollingElement?.scrollTop), "the document itself stays where it is").toBe(0);
      });
    }
  });
}
