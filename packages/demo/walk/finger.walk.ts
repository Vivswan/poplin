// A phone's controls under a finger: each one a person presses is at least 40 px wide and high, whatever part of the library draws it.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, SECTIONS_BUTTON, test, toSection } from "./visit";

/** The least a control measures on a phone, each way, in pixels. */
const FINGER = 40;

/** How far from a control's middle a finger still lands on it, in pixels: a pixel inside half a finger. */
const REACH = FINGER / 2 - 1;

/** The screens, each with the controls that were smaller: a button that opens a sheet, a menu, a dialog, or a hint, a link drawn as a button, a tab, and a field that sits in a group. */
const SCREENS: readonly { readonly section: string; readonly controls: (page: Page) => readonly Locator[] }[] = [
  {
    section: "Sites",
    controls: (page) => [
      page.getByRole("button", { name: SECTIONS_BUTTON }),
      page.getByRole("button", { name: "Refresh the list", exact: true }),
      page.getByRole("button", { name: /^Show link of / }),
      page.getByRole("button", { name: /^Copy the link of / }),
      page.getByRole("button", { name: /^Open the site / }),
      page.getByRole("searchbox", { name: "Find a site", exact: true }),
    ],
  },
  {
    section: "Activity",
    controls: (page) => [page.getByRole("button", { name: /^Only / }), page.getByRole("button", { name: "Download", exact: true }), page.getByRole("searchbox", { name: /^Find activity / })],
  },
  {
    section: "Usage",
    controls: (page) => [page.getByRole("button", { name: /^Change the limit of / }), page.getByRole("button", { name: "Refresh the graph", exact: true }), page.getByRole("button", { name: /: see it at / })],
  },
  {
    section: "Access",
    controls: (page) => [page.getByRole("tab", { name: "Users", exact: true }), page.getByRole("tab", { name: "Tokens", exact: true }), page.getByRole("button", { name: /^More for / })],
  },
  { section: "Domain", controls: (page) => [page.getByRole("button", { name: "Check", exact: true }), page.getByRole("button", { name: "Repair", exact: true })] },
  { section: "Settings", controls: (page) => [page.getByRole("textbox", { name: "Requests per day", exact: true })] },
];

/** The menus and lists a phone opens, each by its screen, the control that opens it, and the role of its lines: a list to choose one of, a list to tick in, and a menu of things to do. */
const MENUS: readonly { readonly section: string; readonly name: string; readonly opener: (page: Page) => Locator; readonly lines: "option" | "menuitem" }[] = [
  { section: "Sites", name: "Which sites", opener: (page) => page.getByRole("combobox", { name: "Which sites", exact: true }), lines: "option" },
  { section: "Activity", name: "Download", opener: (page) => page.getByRole("button", { name: "Download", exact: true }), lines: "menuitem" },
  { section: "Usage", name: "Compare sites", opener: (page) => page.getByRole("combobox", { name: "Compare sites", exact: true }), lines: "option" },
  { section: "Access", name: "More", opener: (page) => page.getByRole("button", { name: /^More for / }), lines: "menuitem" },
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

  for (const menu of MENUS) {
    // Drift: the rule for a phone's sizes would reach the button that opens a menu and miss the menu's own lines, which the library draws 28 px high.
    test(`every line of ${menu.name}, opened on ${menu.section}, is at least ${FINGER} px high`, async ({ page }) => {
      await arrive(page);
      if (menu.section !== "Sites") await toSection(page, menu.section);
      await menu.opener(page).filter({ visible: true }).first().click();

      const lines = page.getByRole(menu.lines);
      await expect(lines.first()).toBeVisible();
      // A menu grows into place as it opens: its lines are measured until they have their whole size.
      const small = (): Promise<number[]> => lines.evaluateAll((all, finger) => all.map((line) => line.getBoundingClientRect().height).filter((height) => height < finger), FINGER);

      await expect.poll(small, "the heights of the lines under a finger's height").toEqual([]);
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

  // Drift: a switch is drawn 18 px high and takes a press in an area around it, which the library makes 34 px high: under a finger its top and bottom would miss.
  test("a switch of Settings takes a press as far above, below and beside its middle as half a finger", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Settings");

    const taken = await page.getByRole("switch").first().evaluate((drawn, reach) => {
      const box = drawn.getBoundingClientRect();
      const [across, down] = [box.left + box.width / 2, box.top + box.height / 2];
      const lands = (x: number, y: number): boolean => drawn.contains(document.elementFromPoint(x, y));

      return [lands(across, down - reach), lands(across, down + reach), lands(across - reach, down), lands(across + reach, down)];
    }, REACH);

    expect(taken, "whether a press above, below, left and right of the switch lands on it").toEqual([true, true, true, true]);
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
