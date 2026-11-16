// The update offered at the side of a screen: where the focus is after its question, and once the update has started; and what the page loaded again says it runs.

import { expect } from "@playwright/test";

import { arrive, reset, test } from "./visit";

// Drift: the question is opened by no trigger of its own, and what it gives the focus back to is noted by hand: noted wrongly, a Cancel would leave the focus in the search of the screen or on the first control of the page.
test("a Cancel of the question before an update leaves the focus on Update now", async ({ page }) => {
  await arrive(page);
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  const question = page.getByRole("alertdialog", { name: /^Update to / });
  await question.getByRole("button", { name: "Cancel", exact: true }).click();

  // The question has a button of the same words: it is gone before the focus is looked at.
  await expect(question).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveText("Update now");
});

// Drift: the button that started an update leaves with the start, and the focus it held would go to the search of the screen again, far from the line that says what to do next.
test("an update started from the side leaves the focus on the line that says to reload the page", async ({ page }) => {
  await arrive(page);
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  await page.getByRole("alertdialog", { name: /^Update to / }).getByRole("button", { name: "Update now", exact: true }).click();

  const next = page.getByText("Updated. Reload the page.", { exact: true });
  await expect(next).toBeVisible();
  await expect(next).toBeFocused();
  // The control: the start left with the update, so the focus is not on it.
  await expect(page.getByRole("button", { name: "Update now", exact: true })).toHaveCount(0);
});

// Drift: the demo said "Updated. Reload the page." and the page loaded again still ran the old version and offered the same update, which reads as an update that failed.
test("after an update the page loaded again says it runs the new version and offers no update, and a reset brings the offer back", async ({ page }) => {
  await arrive(page);
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  const question = page.getByRole("alertdialog", { name: /^Update to / });
  const [, version = ""] = /^Update to (\S+)\?$/u.exec((await question.getByRole("heading").textContent()) ?? "") ?? [];
  await question.getByRole("button", { name: "Update now", exact: true }).click();
  await expect(page.getByText("Updated. Reload the page.", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(`Running poplin ${version}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update now", exact: true })).toHaveCount(0);

  await reset(page);
  await expect(page.getByRole("button", { name: "Update now", exact: true })).toBeVisible();
  expect(version).not.toBe("");
});
