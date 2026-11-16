// The Sites list: the buttons after each site's link stand on one edge down the list, clear of the longest link, in the table and on a phone. And a phone's row says when its site was last updated.

import { expect } from "@playwright/test";

import { arrive, test } from "./visit";

/** The screens the list is walked on: the widest, the narrowest the table fits, and a phone, which draws a row per site in place of the table. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** The least room between the end of a link and the first button after it, in pixels. */
const CLEAR = 8;

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, the links of the sites`, () => {
    test.use({ viewport: size });

    // Drift: the buttons would start where each row's link ends, and zigzag down the list, a row with no eye shifted again; or the longest link would end right at its eye.
    test("have their buttons on one edge, clear of the longest link, whatever a row's link is long and whether or not it has an eye", async ({ page }) => {
      await arrive(page);
      const list = page.getByRole("region", { name: "Sites", exact: true });
      const edges = (name: RegExp): Promise<number[]> =>
        list
          .getByRole("button", { name })
          .filter({ visible: true })
          .evaluateAll((all) => all.map((button) => Math.round(button.getBoundingClientRect().right)));
      const [copies, eyes] = [await edges(/^Copy the link of /), await edges(/^(Show|Hide) link of /)];
      // Of every row with an eye: how far its link ends before the eye begins.
      const rooms = await list
        .getByRole("button", { name: /^Show link of / })
        .filter({ visible: true })
        .evaluateAll((all) => all.map((eye) => Math.round(eye.getBoundingClientRect().left - (eye.parentElement?.previousElementSibling?.firstElementChild?.getBoundingClientRect().right ?? Number.NaN))));

      // The sample holds rows with an eye and rows with none: without both the one edge would prove nothing.
      expect([copies.length > eyes.length, eyes.length > 0, [...new Set(copies)].length, [...new Set(eyes)].length]).toEqual([true, true, 1, 1]);
      expect(rooms.filter((room) => !(room >= CLEAR)), `the rooms under ${CLEAR} px, of ${rooms.length}`).toEqual([]);
    });
  });
}

test.describe("on a phone, a row of the sites", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Drift: a phone's list is ordered by when each site was updated, and its rows would say nothing of when again.
  test("says when its site was last updated, at the row's end, over the button that opens the site", async ({ page }) => {
    await arrive(page);
    const rows = page.getByRole("list", { name: "Sites", exact: true }).getByRole("listitem");
    await expect(rows.first()).toBeVisible();

    const drawn = await rows.evaluateAll((all) =>
      all.map((row) => {
        const [time, open] = [row.querySelector("time"), row.querySelector('a[aria-label^="Open the site "]')];
        const [when, button, mark] = [time?.getBoundingClientRect(), open?.getBoundingClientRect(), open?.querySelector("svg")?.getBoundingClientRect()];
        // Over the button: clear of its mark, and ending between its two sides.
        const over = when !== undefined && button !== undefined && mark !== undefined && when.bottom <= mark.top && when.right > button.left && when.right <= button.right;

        return { said: (time?.textContent ?? "") !== "", over };
      }),
    );
    expect(drawn.filter((row) => !row.said || !row.over)).toEqual([]);
  });
});
