// The Usage table: where the icons at a row's end stand, what a day's line is called once the reader's date is another than the UTC day of its number, and the lines of the host's own figures.

import { expect, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, screenHeading, test } from "./visit";

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
    }
  });
}

// Drift: a day's number is of a UTC day; called "today" on a reader's other date, it reads as the number of a day it is not of.
test("with the reader's clock three days on, a day's line names the UTC day of its number in place of today", async ({ page }) => {
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
