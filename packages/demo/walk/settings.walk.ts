// The Settings screen under the wheel: its rows scroll, and the page around them never does. A count too large to keep, which is refused at its field. The switch of the logs, which stays as it was saved.
// And the moment Save rests after a save the install carries by itself.

import { expect, type Page } from "@playwright/test";

import { arrive, SECTIONS_BUTTON, said, screenHeading, test, toSection } from "./visit";

/** The two sample installs a visitor rule is saved on, each with what the line then says: one holds its key and carries the rule by itself, and the rule of the other waits for a repair. */
const SAVED_ON = [
  { name: "an install that holds its key", settings: "settings", says: "Saved." },
  { name: "an install that holds no key", settings: "empty/settings", says: "Saved. Takes effect at the next Repair." },
] as const;

/** The screens Settings is walked on: the widest, and a phone. */
const SCREENS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** How far one turn of the wheel goes, in pixels, and how many turns reach the end of the longest list of rows. */
const [TURN, TURNS] = [400, 12] as const;

/** A count larger than any a number holds exactly, and what its field is told. */
const TOO_LARGE = { typed: "99999999999999999999", refusal: "Use a whole number from 1 to 1,000,000,000." } as const;

/** The group of the logs: its heading, its one switch, what the row says of it, and the line an install without a key adds under it. */
const LOGS = { group: "Logs", label: "Keep logs", about: "Logs help find a fault; while off, the provider keeps none.", waits: "Takes effect at the next update or Repair." } as const;

/** Turn the wheel down to the end with the pointer at a place of the window. */
async function wheelDown(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  for (let turn = 0; turn < TURNS; turn++) await page.mouse.wheel(0, TURN);
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, Settings`, () => {
    test.use({ viewport: size });

    // Drift: a part of a row that hangs on the page instead of on the row list makes the page taller than the window, and the wheel then slides the title bar and the side menu away, down to a blank screen on a phone.
    test("keeps its title bar and its way to the sections in place when the wheel is turned to the end", async ({ page }) => {
      await arrive(page);
      const sections = page.getByRole("button", { name: SECTIONS_BUTTON });
      const phone = await sections.isVisible();
      await toSection(page, "Settings");
      const rows = page.getByRole("form", { name: "Settings", exact: true }).locator("div").first();
      await expect(page.getByRole("heading", { name: "New sites", exact: true })).toBeVisible();

      // With the pointer over the rows, then over the side of the window, where a wide screen has its side menu.
      await wheelDown(page, size.width - 60, size.height / 2);
      await wheelDown(page, 20, size.height - 200);

      // The rows did move, so the wheel was turned over them: without that the checks below hold of a page that never scrolled at all.
      await expect.poll(() => rows.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight - window.innerHeight]), "how far the page went, and how far it could go").toEqual([0, 0]);
      await expect(screenHeading(page, "Settings")).toBeInViewport({ ratio: 1 });
      await expect(phone ? sections : page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: /^Sites/u })).toBeInViewport({ ratio: 1 });
    });
  });
}

// Drift: the field would turn a count too large to keep into the largest one a number holds, and Save would store that and say "Saved." of a number nobody typed.
test("a count too large to keep is refused at its field, which keeps what was typed", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  const field = page.getByRole("textbox", { name: "Keep versions", exact: true });
  await field.fill(TOO_LARGE.typed);
  await field.press("Enter");

  // The sentence is the field's own: it is marked as refused, and a screen reader says the sentence after its name.
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(new RegExp(TOO_LARGE.refusal.replaceAll(".", "\\.")));
  await expect(page.getByText(TOO_LARGE.refusal, { exact: true })).toBeVisible();
  await expect(field).toHaveValue(TOO_LARGE.typed);
});

for (const install of SAVED_ON) {
  // Drift: a rule of the domain that only a repair writes would be said as "Saved." alone, and read as in effect; or an install that carries the rule by itself would be told to wait for a repair.
  test(`a saved visitor rule says when it takes effect on ${install.name}, with its words whole`, async ({ page }) => {
    await arrive(page);
    await page.goto(install.settings);
    const rule = page.getByRole("switch", { name: "Let search engines in", exact: true });
    await rule.click();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const words = page.getByRole("region", { name: /^Notifications/ }).getByTitle(install.says, { exact: true });
    await expect(words).toBeVisible();
    await expect(page.getByRole("region", { name: /^Notifications/ }).getByRole("button", { name: "Undo", exact: true })).toBeVisible();
    // No part of the words has less room than it needs.
    expect(await words.locator("span").evaluateAll((all) => all.filter((part) => part.scrollWidth > part.clientWidth).map((part) => part.textContent))).toEqual([]);
  });
}

// Drift: the switch of the logs would stand in another group or under other words, come back on after a reload though it was saved off, or say on an install that holds its key that the change waits for an update.
test("Keep logs stands under Logs with its sentence, stays off once it is switched off and saved, and says nothing of waiting on an install that holds its key", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  const group = page.getByRole("region", { name: LOGS.group, exact: true });
  const keep = group.getByRole("switch", { name: LOGS.label, exact: true });

  await expect(keep).toBeChecked();
  await expect(group.getByText(LOGS.about, { exact: false })).toBeVisible();
  await expect(page.getByText(LOGS.waits, { exact: false })).toHaveCount(0);

  await keep.click();
  await expect(keep).not.toBeChecked();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(said(page, "Saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch", { name: LOGS.label, exact: true })).not.toBeChecked();
  await expect(page.getByText(LOGS.waits, { exact: false })).toHaveCount(0);
});

// Drift: a rule or the logs saved on an install that holds its key is written to the provider by itself, once for each save. A Save that took the next press at once would let a switch be flipped three times in two seconds;
// one that never took a press again would leave the second change unsaved.
test("after a save the install carries by itself, Save and Discard take no press for a moment, and then the next change is saved", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  const keep = page.getByRole("switch", { name: LOGS.label, exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });

  await keep.click();
  await save.click();
  await expect(said(page, "Saved.")).toBeVisible();

  await keep.click();
  await expect(page.getByText("1 unsaved change", { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard", exact: true })).toBeDisabled();

  // The moment is five seconds: the wait is twice that, for a machine that is busy.
  await expect(save).toBeEnabled({ timeout: 10_000 });
  await save.click();
  await expect(save).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("switch", { name: LOGS.label, exact: true })).toBeChecked();
});
