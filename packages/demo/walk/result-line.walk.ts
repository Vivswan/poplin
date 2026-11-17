// A result said in a line with a button, about a site with a long title: on a wide screen the line stays inside the header, and still says what was done.
// And a line whose Undo has nothing left to take back: it leaves.

import { expect } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, openPanel, said, screenHeading, test, toSection, trash } from "./visit";

/** The screens the walk is taken on: the widest, and the narrowest the Sites table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** A phone's screen. */
const PHONE = { width: 390, height: 844 } as const;

/** The sample site that goes to the trash and then for good, by its title and its name. */
const GONE = { title: "Pricing", name: "pricing" } as const;

/** The person who is added and then taken out again by the row's own menu. */
const ADDED = "nadia@example.com";

/** How long a line with Undo stays by itself, in milliseconds. A step that says a line was taken away must end sooner, or the line left by itself. */
const UNDO_STAYS_MS = 20_000;

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
      const parts = await words.locator("span:not(:has(span))").evaluateAll((all) => all.map((part) => [part.textContent, part.scrollWidth > part.clientWidth]));
      expect(parts).toEqual([
        [SITE.long, true],
        [" moved to the trash.", false],
      ]);
    });
  });
}

test.describe("on a phone, a result with a button about a site with a long title", () => {
  test.use({ viewport: PHONE });

  // Drift: a phone gives the words two rows, and the title would fill both: the line would name the site and never say what was done to it.
  test("cuts the title alone, and shows what was done whole beside its button", async ({ page }) => {
    await arrive(page);
    await openPanel(page, SITE.was);
    await page.getByRole("dialog", { name: SITE.was, exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
    const edit = page.getByRole("dialog", { name: /^Edit/u });
    await edit.getByRole("textbox", { name: "Title", exact: true }).fill(SITE.long);
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog", { name: SITE.long, exact: true }).getByRole("button", { name: "Delete", exact: true }).click();

    const words = page.getByTitle(`${SITE.long} moved to the trash.`, { exact: true });
    await expect(words).toBeVisible();
    const line = page.locator("[data-sonner-toast]").filter({ has: words });
    await expect(line.getByRole("button", { name: "Undo", exact: true })).toBeInViewport({ ratio: 1 });

    // Each part with what it says, whether it has less room than its words need, and whether it lies whole inside the box that ends the line's words.
    const parts = await words.locator("span:not(:has(span))").evaluateAll((all) =>
      all.map((part) => {
        const [own, room] = [part.getBoundingClientRect(), part.closest("[data-title]")?.getBoundingClientRect()];

        return [part.textContent, part.scrollWidth > part.clientWidth, room !== undefined && own.top >= room.top && own.bottom <= room.bottom + 1 && own.right <= room.right + 1];
      }),
    );
    expect(parts).toEqual([
      [SITE.long, true, true],
      [" moved to the trash.", false, true],
    ]);
  });
});

// Drift: the line that said a site went to the trash stays 20 seconds. Deleted for good meanwhile, its Undo would answer that no site is at the address.
test("the Undo of a site that went to the trash leaves once the site is deleted for good", async ({ page }) => {
  await arrive(page);
  // Noted before the press that makes the line: the line's own time runs from some moment after it.
  const begun = Date.now();
  await trash(page, GONE.title);
  const undo = page.getByRole("region", { name: /^Notifications/ }).getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();

  // The trash is reached inside the page: a page that is loaded anew has no line left.
  await page.getByRole("combobox", { name: "Which sites", exact: true }).click();
  await page.getByRole("option", { name: "Trash", exact: true }).click();
  await page.getByRole("row").getByRole("button", { name: `Details of ${GONE.title}`, exact: true }).press("Enter");
  await page.getByRole("dialog", { name: GONE.title, exact: true }).getByRole("button", { name: "Delete for good", exact: true }).click();
  const asks = page.getByRole("alertdialog", { name: `Delete ${GONE.title} for good?`, exact: true });
  await asks.getByRole("textbox", { name: "Site's name", exact: true }).fill(GONE.name);
  await asks.getByRole("button", { name: "Delete for good", exact: true }).click();

  await expect(said(page, `${GONE.title} deleted for good.`)).toBeVisible();
  await expect(undo).toHaveCount(0);
  expect(Date.now() - begun, "how long ago the line was asked for when it was gone: under the time it leaves in by itself").toBeLessThan(UNDO_STAYS_MS);
});

// Drift: the line that said a person was added stays 20 seconds. Taken out by the row's menu meanwhile, its Undo would answer that the user was removed already.
test("the Undo of an added user leaves once the user is removed by the row's menu", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Access");
  await page.getByRole("button", { name: "Add a user", exact: true }).click();
  const adds = page.getByRole("dialog", { name: "Add a user", exact: true });
  await adds.getByRole("textbox", { name: "Email", exact: true }).fill(ADDED);
  // Noted before the press that makes the line: the line's own time runs from some moment after it.
  const begun = Date.now();
  await adds.getByRole("button", { name: "Add a user", exact: true }).click();
  const undo = page.getByRole("region", { name: /^Notifications/ }).getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();

  await page.getByRole("button", { name: `More for ${ADDED}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();

  await expect(page.getByRole("region", { name: /^Notifications/ }).getByText(/^Removed\./)).toBeVisible();
  await expect(undo).toHaveCount(0);
  expect(Date.now() - begun, "how long ago the line was asked for when it was gone: under the time it leaves in by itself").toBeLessThan(UNDO_STAYS_MS);
});

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, the result of a file that is not the log's last`, () => {
    test.use({ viewport: size });

    // Drift: the button of this line carried five words, "Download the next 2,000": the line's own words were cut short, the row that names its keys took four rows,
    // and the line lay over the tools of the log, where a press on the filter under it landed on the line.
    test("lies inside the header with its words whole, the row of its keys one row, and its button named as the way beside Download is", async ({ page }) => {
      await arrive(page);
      await page.goto("state/activity/long");
      const log = page.getByRole("region", { name: "Activity", exact: true });
      // The stage opens on a narrowed log: the whole one has more entries than a file holds.
      await log.getByRole("button", { name: "Show all activity", exact: true }).click({ timeout: FIRST_LOAD_MS });
      await expect(log.locator("tbody > tr").first()).toBeVisible();
      await log.getByRole("button", { name: "Download", exact: true }).filter({ visible: true }).click();
      await page.getByRole("menuitem", { name: "CSV", exact: true }).click();

      const line = page.getByRole("region", { name: /^Notifications/ }).getByRole("listitem").filter({ hasText: "Downloaded 2,000." });
      const keys = line.getByText("Press Alt+T to reach Next 2,000.", { exact: true });
      await expect(line.getByRole("button", { name: "Next 2,000", exact: true })).toBeVisible();
      await expect(keys).toBeVisible();
      const header = page.locator("header").filter({ has: screenHeading(page, "Activity") });

      // The line slides into its place: its place counts once two frames read it alike.
      await expect(async () => {
        const before = await line.boundingBox();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        const [band, drawn] = await Promise.all([header.boundingBox(), line.boundingBox()]);

        expect(drawn).toEqual(before);
        expect(drawn?.y).toBeGreaterThanOrEqual(band?.y ?? Number.NaN);
        expect((drawn?.y ?? Number.NaN) + (drawn?.height ?? Number.NaN)).toBeLessThanOrEqual((band?.y ?? Number.NaN) + (band?.height ?? Number.NaN));
      }).toPass();

      const words = line.getByText("Downloaded 2,000.", { exact: true });
      const cut = await words.evaluate((drawn) => drawn.scrollWidth > drawn.clientWidth);
      const rows = await keys.evaluate((drawn) => Math.round(drawn.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(drawn).lineHeight)));

      expect([cut, rows]).toEqual([false, 1]);
    });
  });
}
