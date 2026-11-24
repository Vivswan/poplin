// The Tokens tab of Access: the list of tokens keeps its columns when the removed tokens under it are opened, and Enter in a review's field does what Approve does.
// And the pointer over a control: which control shows the hand, and which does not.

import { expect, type Page } from "@playwright/test";

import { FIRST_LOAD_MS, test, toSection } from "./visit";

/** The screens the tables are walked on: the widest, and the narrowest a table fits. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** A text shaped like a code that is the code of no login, since a code has no vowel in it, and what the server says of it. */
const WRONG = { code: "OOOO-OOOO", refusal: "That is not this login's code." } as const;

/** Where each heading of the list of tokens starts, in whole pixels from the window's left edge. */
async function headingStarts(page: Page): Promise<readonly number[]> {
  const headings = page.getByRole("table", { name: "Tokens", exact: true }).getByRole("columnheader");

  return headings.evaluateAll((all) => all.map((heading) => Math.round(heading.getBoundingClientRect().left)));
}

/** The starts of the headings once they have come to rest: a table is measured again once the page's fonts are in, so the fonts are waited for, and then the headings are read until two reads agree. */
async function restedStarts(page: Page): Promise<readonly number[]> {
  await page.evaluate(async () => void (await document.fonts.ready));
  let last: readonly number[] = [];
  await expect(async () => {
    const before = last;
    last = await headingStarts(page);
    expect(last).toEqual(before);
  }).toPass();

  return last;
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, the list of tokens`, () => {
    test.use({ viewport: size });

    // Drift: the list would take the widths the removed tokens need, whose "How" says more than a state, and every column after it would jump to the right when they are opened.
    test("keeps every column where it is when the removed tokens under it are opened", async ({ page }) => {
      await page.goto("tokens/list");
      const removed = page.getByRole("table", { name: "Revoked tokens", exact: true });
      // The rows drawn while the tokens are read have other widths: a token that works is waited for.
      await expect(page.getByRole("table", { name: "Tokens", exact: true }).getByText("Working", { exact: true }).first()).toBeVisible({ timeout: FIRST_LOAD_MS });
      const before = await restedStarts(page);

      await page.getByRole("button", { name: /^Revoked tokens/ }).click();
      await expect(removed.getByRole("row").nth(1)).toBeVisible();
      // The removed tokens are measured after they are drawn, which is when the list above would move.
      await expect(async () => expect(await removed.evaluate((drawn) => drawn.scrollWidth - (drawn.closest('[data-slot="scroll-area"]')?.clientWidth ?? 0))).toBe(0)).toPass();

      expect([before.length > 3, await restedStarts(page)]).toEqual([true, before]);
    });
  });
}

// Drift: Enter in the field of the code would do nothing, where it sends every other form of the dashboard, and a person who pastes the code and presses Enter would wait for an answer that never comes.
test("Enter in the field of a review's code does what Approve does", async ({ page }) => {
  await page.goto("tokens/list");
  const review = page.getByRole("dialog", { name: "Approve this login?", exact: true });
  const field = review.getByRole("textbox", { name: "Code from your terminal", exact: true });
  await page.getByRole("button", { name: "Review", exact: true }).filter({ visible: true }).first().click({ timeout: FIRST_LOAD_MS });
  await field.fill(WRONG.code);
  await field.press("Enter");

  // The server answered the code, which only Approve sends: its refusal stands at the field, and the review stays for the next try.
  await expect(review.getByRole("alert")).toHaveText(WRONG.refusal);
  await expect(field).toBeFocused();
});

// Drift: the CSS framework leaves a button with the arrow, so the pointer stayed an arrow over the tabs Users and Tokens of Access.
test("the pointer is a hand over a tab, a button, a line of a menu, and a switch, and not over a button that is off, a field, or the grip of a column", async ({ page }) => {
  await page.goto("tokens/list");
  const review = page.getByRole("dialog", { name: "Approve this login?", exact: true });
  const opensReview = page.getByRole("button", { name: "Review", exact: true }).filter({ visible: true }).first();
  await expect(opensReview).toBeVisible({ timeout: FIRST_LOAD_MS });

  await expect(page.getByRole("tab", { name: "Users", exact: true })).toHaveCSS("cursor", "pointer");
  await expect(opensReview).toHaveCSS("cursor", "pointer");

  await page.getByRole("button", { name: /^More for / }).first().click();
  await expect(page.getByRole("menuitem", { name: "Revoke", exact: true })).toHaveCSS("cursor", "pointer");
  await page.keyboard.press("Escape");

  // Approve is off until the code is typed. Browsers differ in the pointer they give a button that is off and a field, so only the hand is ruled out.
  await opensReview.click();
  await expect(review.getByRole("button", { name: "Approve", exact: true })).not.toHaveCSS("cursor", "pointer");
  await expect(review.getByRole("textbox", { name: "Code from your terminal", exact: true })).not.toHaveCSS("cursor", "pointer");
  await page.keyboard.press("Escape");

  await toSection(page, "Settings");
  await expect(page.getByRole("switch", { name: "Keep logs", exact: true })).toHaveCSS("cursor", "pointer");

  await toSection(page, "Sites");
  await expect(page.getByRole("button", { name: /^Move the .+ column$/ }).first()).toHaveCSS("cursor", "grab");
});
