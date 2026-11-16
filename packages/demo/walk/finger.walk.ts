// A phone's controls under a finger: each one a person presses is at least 40 px wide and high, whatever part of the library draws it.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, SECTIONS_BUTTON, test, toSection } from "./visit";

/** The least a control measures on a phone, each way, in pixels. */
const FINGER = 40;

/** The screens, each with the controls that were smaller: a button that opens a sheet, a menu, a dialog, or a hint, a link drawn as a button, and a tab. */
const SCREENS: readonly { readonly section: string; readonly controls: (page: Page) => readonly Locator[] }[] = [
  {
    section: "Sites",
    controls: (page) => [
      page.getByRole("button", { name: SECTIONS_BUTTON }),
      page.getByRole("button", { name: "Refresh the list", exact: true }),
      page.getByRole("button", { name: /^Show link of / }),
      page.getByRole("button", { name: /^Copy the link of / }),
      page.getByRole("button", { name: /^Open the site / }),
    ],
  },
  { section: "Activity", controls: (page) => [page.getByRole("button", { name: /^Only / }), page.getByRole("button", { name: "Download", exact: true })] },
  { section: "Usage", controls: (page) => [page.getByRole("button", { name: /^Change the limit of / }), page.getByRole("button", { name: "Refresh the graph", exact: true })] },
  {
    section: "Access",
    controls: (page) => [page.getByRole("tab", { name: "Users", exact: true }), page.getByRole("tab", { name: "Tokens", exact: true }), page.getByRole("button", { name: /^More for / })],
  },
  { section: "Domain", controls: (page) => [page.getByRole("button", { name: "Check", exact: true }), page.getByRole("button", { name: "Repair", exact: true })] },
];

/** What a control is called and how wide and high it is drawn, in whole pixels. */
async function measured(control: Locator): Promise<readonly [string, number, number]> {
  const box = await control.boundingBox();

  return [(await control.getAttribute("aria-label")) ?? (await control.textContent()) ?? "", Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)];
}

test.describe("on a phone, with a pointer that is not a finger", () => {
  // A narrow window is a phone by its width alone: a control must not wait for a touch screen to be large enough.
  test.use({ viewport: { width: 390, height: 844 } });

  for (const screen of SCREENS) {
    // Drift: a button that opens something carries that part's name in the page, and the rule for a phone's sizes would miss it again: 28 px icons and 25 px tabs under a finger.
    test(`every control of ${screen.section} that opens or leads somewhere is at least ${FINGER} px each way`, async ({ page }) => {
      await arrive(page);
      if (screen.section !== "Sites") await toSection(page, screen.section);

      // A screen draws its rows twice, as a table and as a list: the one in sight is measured.
      const controls = screen.controls(page).map((control) => control.filter({ visible: true }).first());
      for (const control of controls) await expect(control).toBeVisible();
      const sizes = await Promise.all(controls.map(measured));

      expect(sizes.filter(([, width, height]) => width < FINGER || height < FINGER), "the controls under a finger's size").toEqual([]);
    });
  }

  // Drift: the way back to a setting's default, a link inside the words about the setting, would stay as low as its line of text under a finger.
  test("the Reset of a changed setting, in what a phone says about the setting, is at least a finger high", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Settings");
    await page.getByRole("textbox", { name: "Requests per day", exact: true }).fill("1000");
    await page.getByRole("button", { name: "About Requests per day", exact: true }).click();

    // What says it grows into place as it opens: the link is measured until it has its whole size.
    const reset = page.getByRole("button", { name: "Reset Requests per day", exact: true }).filter({ visible: true }).first();
    await expect.poll(async () => (await measured(reset))[2]).toBeGreaterThanOrEqual(FINGER);
  });

  // Drift: the mark that narrows Activity to one site would stay lower than the button inside it, and cut the button's top and bottom off.
  test("the mark of the one site Activity shows holds its button whole", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Activity");
    await page.getByRole("button", { name: /^Only / }).filter({ visible: true }).first().click();

    const close = page.getByRole("button", { name: "Show every site", exact: true });
    const [button, mark] = [await close.boundingBox(), await close.locator("xpath=..").boundingBox()];
    const [top, bottom] = [(button?.y ?? 0) - (mark?.y ?? 0), (mark?.y ?? 0) + (mark?.height ?? 0) - (button?.y ?? 0) - (button?.height ?? 0)];

    expect([await measured(close), top >= 0, bottom >= 0], "the button's size, and whether its top and its bottom lie inside the mark").toEqual([["Show every site", FINGER, FINGER], true, true]);
  });
});
