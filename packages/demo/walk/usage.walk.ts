// The Usage screen in a browser: that the table fits its room, where the icons at a row's end stand, what a day's line is called, the lines of the host's own figures, and where the numbers of a phone's list end.

import { expect, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, screenHeading, test, toSection } from "./visit";

/** The screens the walk is taken on: the widest, and the narrowest the table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** The two installs of the demo, by how each is reached, with the kinds of icon a row of its table ends in: the sample install shows the host's own figures, and the one that holds nothing keeps no key, so its own lines lead to the host's pages. */
const INSTALLS = [
  { name: "the install with the host's figures", empty: false, kinds: ["host", "setting"] },
  { name: "the install without a key", empty: true, kinds: ["host", "host setting", "setting"] },
] as const;

/** Three days in milliseconds: further than any time zone is from UTC. */
const THREE_DAYS_MS = 259_200_000;

/** Open the Usage screen of the sample install by its section, or of the install that holds nothing by its address. */
async function openUsage(page: Page, empty: boolean): Promise<void> {
  if (empty) {
    await page.goto("./empty/usage");
    await expect(screenHeading(page, "Usage")).toBeVisible({ timeout: FIRST_LOAD_MS });

    return;
  }

  await arrive(page);
  await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: /^Usage/u }).click();
  await expect(screenHeading(page, "Usage")).toBeVisible();
}

/** How much wider than its room the Usage table is, in pixels, and the values of it that lost their end. */
function fit(page: Page): Promise<{ over: number; cut: string[] }> {
  return page.getByRole("table", { name: "Usage", exact: true }).evaluate((drawn) => {
    const room = drawn.closest('[data-slot="scroll-area-viewport"]');
    const cut = [...drawn.querySelectorAll<HTMLElement>("tbody .truncate")].filter((value) => value.scrollWidth > value.clientWidth).map((value) => value.textContent ?? "");

    return { over: (room?.scrollWidth ?? 0) - (room?.clientWidth ?? -1), cut };
  });
}

// Drift: the table would keep the widths it measured with its bars after the window is made too narrow for them, and scroll sideways in a room a fresh load fits.
test("a window made narrower, from 1440 px to 1024 px, still holds the whole Usage table, and its bars are gone", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openUsage(page, false);
  const bars = page.getByRole("table", { name: "Usage", exact: true }).getByRole("progressbar");
  await expect(bars.first()).toBeVisible();
  // The control: the wide table is measured for good, with its fonts in, before the window changes. A measuring still to come would fit the narrow table whatever the resize did.
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => fit(page)).toEqual({ over: 0, cut: [] });

  await page.setViewportSize({ width: 1024, height: 768 });

  await expect(bars).toHaveCount(0);
  await expect.poll(() => fit(page)).toEqual({ over: 0, cut: [] });
});

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, in the Usage table`, () => {
    test.use({ viewport: size });

    for (const install of INSTALLS) {
      // Drift: the two kinds of icon would stand in a column each again, so a row with one of them ends short of the row with the other, and the icons read as indented against each other.
      test(`in ${install.name}, the last icon of every row ends at one right edge, and a row with both has the host's page before the setting`, async ({ page }) => {
        await openUsage(page, install.empty);
        const table = page.getByRole("table", { name: "Usage", exact: true });
        await expect(table.getByRole("row").nth(1)).toBeVisible();

        const rows = await table.locator("tbody tr").evaluateAll((all) =>
          all
            .map((row) => [...row.querySelectorAll("td:last-child a")].map((icon) => ({ name: icon.getAttribute("aria-label") ?? "", box: icon.getBoundingClientRect() })))
            .filter((icons) => icons.length > 0)
            .map((icons) => ({ kinds: icons.map((icon) => (icon.name.startsWith("Change the limit") ? "setting" : "host")), end: icons.at(-1)?.box.right, sizes: icons.map((icon) => `${icon.box.width}x${icon.box.height}`) })),
        );
        // The control: every kind of row the install has is there.
        expect([...new Set(rows.map((row) => row.kinds.join(" ")))].sort()).toEqual([...install.kinds]);
        expect({ ends: new Set(rows.map((row) => row.end)).size, sizes: new Set(rows.flatMap((row) => row.sizes)).size }).toEqual({ ends: 1, sizes: 1 });
      });

      // Drift: the columns would need more than the room of the narrowest screen again, so the table scrolls sideways inside itself and "Near the limit" loses its end.
      test(`in ${install.name}, the table is as wide as its room and no value is cut`, async ({ page }) => {
        await openUsage(page, install.empty);
        const table = page.getByRole("table", { name: "Usage", exact: true });
        await expect(table.getByRole("row").nth(1)).toBeVisible();

        // The control: the sample install has a line near its limit, whose words are the widest of their column.
        expect((await table.getByText("Near the limit", { exact: true }).count()) > 0).toBe(!install.empty);
        // The table measures its columns again once its fonts are in: the reading is taken until it holds.
        await expect.poll(() => fit(page)).toEqual({ over: 0, cut: [] });
      });
    }
  });
}

// Drift: a day's number is of a UTC day; called "today" on a reader's other date, it reads as the number of a day it is not of.
// A name with a day in it is the longest there is: held to the width of any other column, it would lose its end on a screen with room to spare.
test("with the reader's clock three days on, a day's line names the UTC day of its number in place of today, and every name is whole", async ({ page }) => {
  await page.clock.setFixedTime(Date.now() + THREE_DAYS_MS);
  await openUsage(page, false);
  const names = page.getByRole("table", { name: "Usage", exact: true }).locator("tbody td:first-child");
  await expect(names.first()).toBeVisible();

  const days = (await names.allTextContents()).filter((name) => name.startsWith("Requests") || name.startsWith("Database rows"));
  expect(days.map((name) => name.replace(/\d{2} [A-Z][a-z]{2}/u, "DD Mon"))).toEqual([
    "Requests on DD Mon UTC",
    "Requests stopped by a limit on DD Mon UTC",
    "Database rows read on DD Mon UTC",
    "Database rows written on DD Mon UTC",
  ]);
  // The table measures its columns again once its fonts are in: the reading is taken until it holds.
  await expect.poll(() => names.locator(".truncate").evaluateAll((all) => all.filter((name) => name.scrollWidth > name.clientWidth).map((name) => name.textContent))).toEqual([]);
});

test.describe("on a phone, in the list of Usage", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Drift: a line's limit would stand beside its number again, so each number ends where its own limit starts, and the numbers of the list end at as many edges as the limits have lengths.
  test("every number ends at one right edge, and every limit ends under it", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Usage");
    const lines = page.getByRole("list", { name: "Usage", exact: true }).getByRole("listitem");
    await expect(lines.first()).toBeVisible();

    // Of every line: where its number ends, where its limit ends, and the limit's words.
    const ends = await lines.evaluateAll((all) =>
      all.map((line) => {
        const [used, limit] = [line.children[0]?.children[1], line.children[1]?.children[0]];

        return { used: Math.round(used?.getBoundingClientRect().right ?? 0), limit: Math.round(limit?.getBoundingClientRect().right ?? -1), words: limit?.textContent ?? "" };
      }),
    );
    // The control: what is measured as a limit reads as one, and the limits are of more than one length.
    expect([ends.every((line) => /^(of .+|No limit)$/u.test(line.words)), new Set(ends.map((line) => line.words.length)).size > 1]).toEqual([true, true]);
    expect([...new Set(ends.flatMap((line) => [line.used, line.limit]))]).toHaveLength(1);
  });
});

test.describe("for a reader in UTC, whose date is the day of the numbers", () => {
  test.use({ timezoneId: "UTC" });

  // Drift: the sample install would show the install's own lines alone again, so nobody who looks at the demo sees a line of the host's figures; or a slow day would be written as a limit passed while no request was stopped.
  test("the sample install shows the host's own figures: how far behind they run, the size of the database, the jobs, and a sign in place of words on a processing time above its limit", async ({ page }) => {
    await openUsage(page, false);
    const table = page.getByRole("table", { name: "Usage", exact: true });
    await expect(table.getByRole("row").nth(1)).toBeVisible();
    const cells = await table.locator("tbody tr").evaluateAll((all) => all.map((row) => [...row.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent ?? "")));
    const shown = cells.filter(([name]) => ["Database size", "Account database size", "Requests stopped by a limit today", "Processing time, slowest 1 in 100, today", "Background jobs running now"].includes(name ?? ""));
    const sign = table.getByRole("button", { name: /Requests are stopped/u });

    await expect(page.getByText(/own figures, as of .+\. They run about 10 minutes behind\.$/u)).toBeVisible();
    expect(shown).toEqual([
      ["Database size", "1.4 MB", "500 MB"],
      ["Account database size", "at most 2.3 MB", "5 GB"],
      ["Requests stopped by a limit today", "0", "No limit"],
      ["Processing time, slowest 1 in 100, today", "12.4 ms", "10 ms"],
      ["Background jobs running now", "1", "100"],
    ]);
    await sign.hover();
    await expect(page.locator("[data-slot=tooltip-content]")).toHaveText("Requests are stopped only when the host says so: see Requests stopped by a limit.");
    await expect(table.getByRole("row", { name: /^Processing time/u }).getByText(/the limit/u)).toHaveCount(0);
  });
});
