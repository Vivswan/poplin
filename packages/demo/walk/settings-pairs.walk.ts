// Settings that bound one another: a switch that needs another one, and a limit put above the limit that bounds it.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, said, test, toSection } from "./visit";

/** What a switch says while the switch it needs is off. */
const CHECK_FIRST = "Switch on the check above first.";

/** The warnings under a limit above the limit that bounds it. */
const ABOVE = {
  allSites: "More than all sites together may hold, so that limit is reached first.",
  oneSite: "More than one site answers in a minute, so that limit is reached first.",
} as const;

/** The switch of a setting, by its name. */
function setting(page: Page, name: string): Locator {
  return page.getByRole("switch", { name, exact: true });
}

// Drift: the check switched off left "Update automatically" on and pressable under "Needs the check above.", and Save stored a pair that cannot work.
test("switching the check for new versions off switches automatic updates off with it, and locks that switch until the check is on again", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  const [check, automatic] = [setting(page, "Check for new versions"), setting(page, "Update automatically")];
  if (!(await check.isChecked())) await check.click();

  if (!(await automatic.isChecked())) await automatic.click();

  await expect(automatic).toBeChecked();

  await check.click();
  await expect(automatic).not.toBeChecked();
  await expect(automatic).toBeDisabled();
  await expect(page.getByText(CHECK_FIRST, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(said(page, "Saved.")).toBeVisible();

  await page.reload();
  await expect(setting(page, "Check for new versions")).not.toBeChecked();
  await expect(setting(page, "Update automatically")).not.toBeChecked();
  await expect(setting(page, "Update automatically")).toBeDisabled();

  await setting(page, "Check for new versions").click();
  await expect(setting(page, "Update automatically")).toBeEnabled();
  await expect(page.getByText(CHECK_FIRST, { exact: true })).toHaveCount(0);
});

// Drift: one site was given more room than all sites together, and one visitor more requests than a site answers, and each was saved with no word at its field.
test("a limit typed above the limit that bounds it says so under its field, before any Save, and no longer once it is back under it", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  // A field writes its count with separators between the thousands.
  const count = async (name: string): Promise<number> => Number((await page.getByRole("textbox", { name, exact: true }).inputValue()).replaceAll(",", ""));
  const [all, site] = [await count("All sites together"), await count("One site per minute")];
  const [one, visitor] = [page.getByRole("textbox", { name: "One site", exact: true }), page.getByRole("textbox", { name: "One visitor per minute", exact: true })];

  await one.fill(String(all + 1));
  await visitor.fill(String(site + 1));
  await expect(page.locator("[data-slot='setting-warnings']").getByText(ABOVE.allSites, { exact: true })).toBeVisible();
  await expect(page.locator("[data-slot='setting-warnings']").getByText(ABOVE.oneSite, { exact: true })).toBeVisible();

  await one.fill(String(all));
  await visitor.fill(String(site));
  await expect(page.getByText(ABOVE.allSites, { exact: true })).toHaveCount(0);
  await expect(page.getByText(ABOVE.oneSite, { exact: true })).toHaveCount(0);
  expect([all > 0, site > 0]).toEqual([true, true]);
});

// Drift: the warning was measured against the bounding limit as it was saved, so a site's limit lowered under a visitor's in its own field warned of nothing until Save.
test("the limit that bounds another, typed under it, puts the warning under the other field before any Save, and takes it away once typed back", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  const field = (name: string): Locator => page.getByRole("textbox", { name, exact: true });
  const count = async (name: string): Promise<number> => Number((await field(name).inputValue()).replaceAll(",", ""));
  const [site, visitor, all, one] = [await count("One site per minute"), await count("One visitor per minute"), await count("All sites together"), await count("One site")];
  const warnings = page.locator("[data-slot='setting-warnings']");

  await field("One site per minute").fill(String(visitor - 1));
  await field("All sites together").fill(String(one - 1));
  await expect(warnings.getByText(ABOVE.oneSite, { exact: true })).toBeVisible();
  await expect(warnings.getByText(ABOVE.allSites, { exact: true })).toBeVisible();

  await field("One site per minute").fill(String(site));
  await field("All sites together").fill(String(all));
  await expect(page.getByText(ABOVE.oneSite, { exact: true })).toHaveCount(0);
  await expect(page.getByText(ABOVE.allSites, { exact: true })).toHaveCount(0);
  expect([visitor > 1, one > 1]).toEqual([true, true]);
});
