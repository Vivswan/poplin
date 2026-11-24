// The update offered in the row of the version, on Settings: the mark at the side that leads to it, where the focus is after its question and once the update has started, and what the page loaded again says it runs.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, onPage, reset, test, toSection } from "./visit";

/** The screens the way to the row is walked on: a wide one, and a phone, which keeps the sections behind a button. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** The row of the version, the first of Updates. */
function versionRow(page: Page): Locator {
  return page.locator("#setting-version");
}

/** The start of the update, in the row. */
function start(page: Page): Locator {
  return versionRow(page).getByRole("button", { name: "Update now", exact: true });
}

/** The link of Settings among the sections of a wide screen, by its whole name: the mark it carries is part of it. */
function settingsLink(page: Page, name: string): Locator {
  return onPage(onPage(page, "navigation", { name: "Sections", exact: true }), "link", { name, exact: true });
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide`, () => {
    test.use({ viewport: size });

    // Drift: the start of an update stands in the last group of a long screen. A mark that led to the top of Settings would leave it a screen or more further down, with nothing in sight that says where.
    test("the mark of a newer release at Settings leads to the row of the version: the row is in sight under its name, with the version it runs, and the start of the update has the focus", async ({ page }) => {
      await arrive(page);
      await toSection(page, "Settings");

      await expect(start(page)).toBeFocused();
      await expect(start(page)).toBeInViewport({ ratio: 1 });
      await expect(versionRow(page).getByRole("heading", { name: "Version", exact: true })).toBeInViewport({ ratio: 1 });
      await expect(versionRow(page).getByText(/^\d+\.\d+\.\d+$/u)).toBeInViewport({ ratio: 1 });
    });
  });
}

// Drift: the question is drawn once, apart from the two buttons that ask it. A question that lost the button that asked would leave the focus on the screen's title or on the first control of the page after a Cancel.
test("a Cancel of the question before an update leaves the focus on Update now", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  await start(page).click();
  await page.getByRole("alertdialog", { name: /^Update to / }).getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(start(page)).toBeFocused();
});

// Drift: the button that started an update leaves with the start, and the focus it held would go to the first field of the screen again, far from the line that says what to do next.
test("an update started from the row leaves the focus on the line that says to reload the page", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  await start(page).click();
  await page.getByRole("alertdialog", { name: /^Update to / }).getByRole("button", { name: "Update now", exact: true }).click();

  const next = versionRow(page).getByText("Updated. Reload the page.", { exact: true });
  await expect(next).toBeVisible();
  await expect(next).toBeFocused();
  // The control: the start left with the update, so the focus is not on it.
  await expect(start(page)).toHaveCount(0);
});

// Drift: the demo said "Updated. Reload the page." and the page loaded again still ran the old version, offered the same update, and marked Settings for it, which reads as an update that failed.
test("after an update the page loaded again says it runs the new version, offers no update, and marks Settings no more; a reset brings the offer and the mark back", async ({ page }) => {
  await arrive(page);
  await expect(settingsLink(page, "Settings update available")).toBeVisible();
  await toSection(page, "Settings");
  await start(page).click();
  const question = page.getByRole("alertdialog", { name: /^Update to / });
  const [, version = ""] = /^Update to (\S+)\?$/u.exec((await question.getByRole("heading").textContent()) ?? "") ?? [];
  await question.getByRole("button", { name: "Update now", exact: true }).click();
  await expect(page.getByText("Updated. Reload the page.", { exact: true })).toBeVisible();

  await page.reload();
  await expect(versionRow(page).getByText(version, { exact: true })).toBeVisible();
  await expect(start(page)).toHaveCount(0);
  await expect(settingsLink(page, "Settings")).toBeVisible();

  await reset(page);
  await expect(start(page)).toBeVisible();
  await expect(settingsLink(page, "Settings update available")).toBeVisible();
  expect(version).not.toBe("");
});
