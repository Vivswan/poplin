// The update offered in the row of the version, on Settings: the mark at the side that leads to it, where the focus is after its question and once the update has started, and what the page loaded again says it runs.
// And Check now, in the same row: what a press finds on an install that knows of no release, and what it says once the install runs the newest.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, onPage, reset, test, toSection } from "./visit";

/** What a screen with the sections at its side has room for: the row's name, the version, and what the row holds at its right on one line, with the next row under it. */
const ONE_LINE = {
  says: "the row of the version is one line: the version beside its name, and at the right the notes of the newer release with Update now after them",
  beside: (page: Page) => [notes(page), start(page)],
  under: (page: Page) => [page.getByRole("heading", { name: "Check for new versions", exact: true })],
} as const;

/**
 * The screens the row is walked on: a wide one, a tablet, where the column of the controls is at its narrowest, and a phone, which keeps the sections behind a button.
 *
 * Each with what stands on the line of the row's name there, after the version, and with what stands under that line. On a phone what the row holds is under the line.
 */
const SCREENS = [
  { size: { width: 1440, height: 900 }, ...ONE_LINE },
  { size: { width: 820, height: 1100 }, ...ONE_LINE },
  {
    size: { width: 390, height: 844 },
    says: "the version stands beside the name of its row, and the notes of the newer release and Update now under them",
    beside: () => [],
    under: (page: Page) => [notes(page), start(page)],
  },
] as const;

/** How far apart, in pixels, the middles of two parts of one line may be: a text and a button are drawn at different heights around one middle. */
const LINE_SLACK = 2;

/** The row of the version, the first of Updates. */
function versionRow(page: Page): Locator {
  return page.locator("#setting-version");
}

/** The name of the row. */
function name(page: Page): Locator {
  return versionRow(page).getByRole("heading", { name: "Version", exact: true });
}

/** The version the install runs, as the row says it. */
function running(page: Page): Locator {
  return versionRow(page).getByText(/^\d+\.\d+\.\d+$/u);
}

/** The link to the notes of the newer release, in the row. */
function notes(page: Page): Locator {
  return versionRow(page).getByRole("link", { name: "What changed", exact: true });
}

/** The start of the update, in the row. */
function start(page: Page): Locator {
  return versionRow(page).getByRole("button", { name: "Update now", exact: true });
}

/** The asking for a newer version, in the row. */
function checkNow(page: Page): Locator {
  return versionRow(page).getByRole("button", { name: "Check now", exact: true });
}

/**
 * How far down the page the middle of each of some parts is.
 *
 * @returns the distances in pixels, with no number for a part that has no box: such a part is on no line and under none
 */
async function middles(parts: readonly Locator[]): Promise<number[]> {
  const boxes = await Promise.all(parts.map((part) => part.boundingBox()));

  return boxes.map((box) => (box === null ? Number.NaN : box.y + box.height / 2));
}

/** The link of Settings among the sections of a wide screen, by its whole name: the mark it carries is part of it. */
function settingsLink(page: Page, name: string): Locator {
  return onPage(onPage(page, "navigation", { name: "Sections", exact: true }), "link", { name, exact: true });
}

for (const { size, says, beside, under } of SCREENS) {
  test.describe(`on a screen ${size.width} px wide`, () => {
    test.use({ viewport: size });

    // Drift: the start of an update stands in the last group of a long screen. A mark that led to the top of Settings would leave it a screen or more further down, with nothing in sight that says where.
    test("the mark of a newer release at Settings leads to the row of the version: the row is in sight with its name and the version it runs, and the start of the update has the focus", async ({ page }) => {
      await arrive(page);
      await toSection(page, "Settings");

      await expect(start(page)).toBeFocused();
      await expect(start(page)).toBeInViewport({ ratio: 1 });
      await expect(name(page)).toBeInViewport({ ratio: 1 });
      await expect(running(page)).toBeInViewport({ ratio: 1 });
    });

    // Drift: the version stood at the right, the newer release under it, and Update now under both: three lines that read as two rows.
    test(says, async ({ page }) => {
      await arrive(page);
      await toSection(page, "Settings");

      const line = await middles([name(page), running(page), ...beside(page)]);
      const lower = await middles(under(page));

      expect(Math.max(...line) - Math.min(...line)).toBeLessThanOrEqual(LINE_SLACK);
      // The control: what stands under the line is further down than the slack, so the measure tells one line from the next.
      expect(Math.min(...lower) - Math.max(...line)).toBeGreaterThan(LINE_SLACK);
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

// Drift: right after a release the row was empty until the day's own asking, with nothing to press. A press whose answer took the button away and left the focus on the page would leave a keyboard nowhere.
test("Check now, on an install that knows of no release, finds the newer one: its notes stand in the button's place, and have the focus", async ({ page }) => {
  await page.goto("./empty/settings");
  await expect(checkNow(page)).toBeVisible({ timeout: FIRST_LOAD_MS });
  await checkNow(page).focus();
  await page.keyboard.press("Enter");

  await expect(notes(page)).toBeFocused();
  expect(await versionRow(page).textContent()).toMatch(/\d+\.\d+\.\d+ is out\. What changed/u);
  // The control: the button left with the answer, so the focus is not on it.
  await expect(checkNow(page)).toHaveCount(0);
});

// Drift: a press that found nothing and said nothing reads as a button that does not work, and one whose answer dropped the focus to the page would leave a keyboard nowhere.
test("after an update, Check now says the install is up to date, and keeps the focus", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  await start(page).click();
  await page.getByRole("alertdialog", { name: /^Update to / }).getByRole("button", { name: "Update now", exact: true }).click();
  await expect(page.getByText("Updated. Reload the page.", { exact: true })).toBeVisible();
  await page.reload();

  await checkNow(page).focus();
  await page.keyboard.press("Enter");
  await expect(versionRow(page).getByText("Up to date. Checked just now.", { exact: true })).toBeVisible();
  await expect(checkNow(page)).toBeFocused();
});
