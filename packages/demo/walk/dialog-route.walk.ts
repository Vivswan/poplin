// A dialog belongs to the place it was opened at: the browser's Back closes it with its panel, and nothing is left over the list that could still change a site.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, openPanel, siteNames, TRASH, test } from "./visit";

/** The title of the sample site that starts in the trash. */
const TRASHED = "Notes from the offsite";

/** The dialogs a site's panel opens, each by the press that opens it and by what it is then found as. */
const DIALOGS: readonly { readonly name: string; readonly open: (panel: Locator) => Promise<void>; readonly shown: (page: Page) => Locator }[] = [
  { name: "Edit", open: (panel) => panel.getByRole("button", { name: "Edit", exact: true }).click(), shown: (page) => page.getByRole("dialog", { name: "Edit the site", exact: true }) },
  { name: "Duplicate", open: (panel) => panel.getByRole("button", { name: "Duplicate", exact: true }).click(), shown: (page) => page.getByRole("dialog", { name: /^Duplicate/u }) },
  { name: "New link", open: (panel) => panel.getByRole("button", { name: "New link", exact: true }).click(), shown: (page) => page.getByRole("alertdialog", { name: "Make a new link?", exact: true }) },
];

for (const dialog of DIALOGS) {
  // Drift: the panel closed with the address and its dialog stayed over the list, where its button still changed the site.
  test(`Back with ${dialog.name} open closes the dialog together with the panel`, async ({ page }) => {
    const [first = ""] = await arrive(page);
    await openPanel(page, first);
    const panel = page.getByRole("dialog", { name: first, exact: true });
    await dialog.open(panel);
    await expect(dialog.shown(page)).toBeVisible();

    await page.goBack();

    await expect(dialog.shown(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(siteNames(page).first()).toBeVisible();
  });
}

// Drift: the question of a delete for good opens itself, by the library's own trigger, and no screen holds whether it is open: it would be the one question a Back leaves behind.
test("Back with Delete for good open closes the question together with the panel", async ({ page }) => {
  await arrive(page);
  await page.goto(TRASH);
  await page.getByRole("row").getByRole("button", { name: `Details of ${TRASHED}`, exact: true }).press("Enter");
  await page.getByRole("dialog", { name: TRASHED, exact: true }).getByRole("button", { name: "Delete for good", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();

  await page.goBack();

  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(siteNames(page).first()).toBeVisible();
});
