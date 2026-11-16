// The Activity log in its room: what the table's columns show whole and where the room they leave over goes, and what a phone's row shows whole.
// And the screen at rest and narrowed to one site: which entries it shows stands in sight on a line of its own over the list, with the tools whole over it.

import { expect, type Locator } from "@playwright/test";

import { arrive, screenHeading, test, toSection } from "./visit";

/** The screens the walk is taken on: the widest, with room to spare beside the columns, and the narrowest the table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** How long a press that is only tried waits for a tool to be in reach, in milliseconds: a tool under another one never is. */
const REACH_MS = 3000;

/** The screens the words over the list are looked for on: those of the table, the narrowest whose row of tools holds the mark of one site, and a phone. */
const AT_REST = [...SCREENS, { width: 1280, height: 800 }, { width: 390, height: 844 }] as const;

/** The sample site with the longest title, which the mark of one site is widest for. */
const LONGEST = "Notes from the offsite";

/** The tools of the log that a line too full pushes under one another: the search, the far button of the time zone, and Download. */
function toolsOf(log: Locator): readonly Locator[] {
  return [log.getByRole("searchbox", { name: /^Find activity / }), log.getByRole("button", { name: "UTC", exact: true }), log.getByRole("button", { name: "Download", exact: true })];
}

/** Hold that each tool is whole, all of it inside the window, and in reach: a press on it would land on it, which a press that is only tried says without pressing. */
async function expectInReach(tools: readonly Locator[]): Promise<void> {
  for (const tool of tools) {
    await expect(tool).toBeInViewport({ ratio: 1 });
    await tool.click({ trial: true, timeout: REACH_MS });
  }
}

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

test.describe("on a phone, in the Activity list", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Drift: what was done would be cut again ("Deleted (moved to the tr...") where the site beside it has a long title: the two stood on one line that only what was done gave room on.
  test("a row says what was done and the site's title whole, the title under what was done where the two have no room side by side", async ({ page }) => {
    await arrive(page);
    await page.getByRole("button", { name: /^Sections/u }).click();
    await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: "Activity", exact: true }).click();
    const row = page.getByRole("list", { name: "Activity", exact: true }).getByRole("listitem").filter({ hasText: "Deleted (moved to the trash)" }).filter({ hasText: "Notes from the offsite" }).first();
    await row.scrollIntoViewIfNeeded();

    expect(await row.evaluate((item) => [...item.querySelectorAll("*")].filter((part) => getComputedStyle(part).overflowX !== "visible" && part.scrollWidth > part.clientWidth).map((part) => part.textContent))).toEqual([]);
    const [what, site] = await Promise.all(["Deleted (moved to the trash)", "Notes from the offsite"].map((words) => row.getByText(words, { exact: true }).boundingBox()));
    expect(site?.y ?? 0).toBeGreaterThan((what?.y ?? Number.NaN) + (what?.height ?? Number.NaN) / 2);
  });
});

for (const size of AT_REST) {
  test.describe(`on a screen ${size.width} px wide, Activity at rest`, () => {
    test.use({ viewport: size });

    // Drift: the words stood only after the last row, where no screen shows them at rest. Put into the row of tools on a screen with no room for them, they pushed the time zone's buttons under Download.
    test("says which entries it shows before any scroll, with the search, the time zone and Download whole and in reach", async ({ page }) => {
      await arrive(page);
      await toSection(page, "Activity");
      const log = page.getByRole("region", { name: "Activity", exact: true });
      const shown = log.getByText(/^1 to 50 of [0-9,]+$/).filter({ visible: true }).first();
      await expect(shown).toBeInViewport({ ratio: 1 });

      await expectInReach(toolsOf(log));
    });

    // Drift: the words would stand in the row of tools again, where the mark of one site stands too: with a long title in the mark, the row has no room for both, and the time zone's buttons go under Download.
    test("narrowed to the site with the longest title, the words stand on a line of their own under every tool, and the tools stay whole and in reach", async ({ page }) => {
      await arrive(page);
      await toSection(page, "Activity");
      const log = page.getByRole("region", { name: "Activity", exact: true });
      await log.getByRole("button", { name: `Only ${LONGEST}`, exact: true }).filter({ visible: true }).first().click();
      const mark = log.getByRole("button", { name: "Show every site", exact: true });
      await expect(mark).toBeVisible();
      // The mark's button takes the focus and shows its hint, which on a phone lies over the search: Escape puts the hint away.
      await page.keyboard.press("Escape");
      const shown = log.getByText(/^1 to [0-9]+ of [0-9,]+$/).filter({ visible: true }).first();
      await expect(shown).toBeInViewport({ ratio: 1 });

      await expectInReach(toolsOf(log));
      const [words, ...boxes] = await Promise.all([shown, ...toolsOf(log), mark].map((part) => part.boundingBox()));
      const lowest = Math.max(...boxes.map((box) => (box?.y ?? Number.NaN) + (box?.height ?? Number.NaN)));
      expect(words?.y ?? Number.NaN, "the top of the words, under the bottom of the lowest tool").toBeGreaterThanOrEqual(lowest);
    });
  });
}
