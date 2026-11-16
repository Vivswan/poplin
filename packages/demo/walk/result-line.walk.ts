// A result said in a line with a button, about a site with a long title: on a wide screen the line stays inside the header, and still says what was done.
// And a line whose Undo has nothing left to take back: it leaves.

import { expect } from "@playwright/test";

import { arrive, openPanel, said, screenHeading, test, toSection, trash } from "./visit";

/** The screens the walk is taken on: the widest, and the narrowest the Sites table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

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
      const parts = await words.locator("span").evaluateAll((all) => all.map((part) => [part.textContent, part.scrollWidth > part.clientWidth]));
      expect(parts).toEqual([
        [SITE.long, true],
        [" moved to the trash.", false],
      ]);
    });
  });
}

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
