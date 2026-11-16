// A site's panel on the screens between a phone and the widest: it lies over the end of the list, which stays in sight and in reach beside it. And its Edit, which starts from what the site holds every time it is opened.

import { expect } from "@playwright/test";

import { arrive, openPanel, siteName, test } from "./visit";

/** The screens the walk is taken on: the narrowest the Sites table fits, and one between it and the widest. */
const SCREENS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const;

/** The sample sites the walk opens and looks for, by their titles. */
const SAMPLE = { opened: "Pricing", beside: "Team handbook" } as const;

/** What is typed into the Edit of a site and then left. */
const DRAFT = { title: "Draft X", name: "ab" } as const;

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, under a site's panel`, () => {
    test.use({ viewport: size });

    // Drift: the panel would take the whole room of the list again on a screen narrower than the widest, where no row is seen or pressed while it is open.
    test("the panel is 440 px wide at the end of the screen, the table keeps its width, a site's title stays in sight beside it, and a press under the last row closes it", async ({ page }) => {
      await arrive(page);
      const list = page.getByRole("region", { name: "Sites", exact: true });
      const table = page.getByRole("table", { name: "Sites", exact: true });
      const without = await table.boundingBox();

      await openPanel(page, SAMPLE.opened);
      await expect(page.getByRole("dialog", { name: SAMPLE.opened, exact: true })).toBeVisible();
      // The panel's place, hairline included.
      const over = await page.getByRole("complementary", { name: SAMPLE.opened, exact: true }).boundingBox();
      expect(over === null ? undefined : { width: over.width, end: over.x + over.width }).toEqual({ width: 440, end: size.width });
      expect(await table.boundingBox()).toEqual(without);
      const title = await siteName(page, SAMPLE.beside).boundingBox();
      expect((title?.x ?? Number.NaN) + (title?.width ?? Number.NaN)).toBeLessThanOrEqual(over?.x ?? 0);

      const room = await list.boundingBox();
      await page.mouse.click((room?.x ?? 0) + 120, (room?.y ?? 0) + (room?.height ?? 0) - 20);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Details of ${SAMPLE.opened}`, exact: true })).toBeFocused();
    });
  });
}

// Drift: the Edit of a site is kept while it is closed, so what was typed and left would be there at the next opening, with Save lit over a change nobody means.
for (const leave of ["Cancel", "Escape"] as const) {
  test(`an Edit that was left by ${leave} starts from what the site holds when it is opened again`, async ({ page }) => {
    await arrive(page);
    await openPanel(page, SAMPLE.opened);
    const edit = page.getByRole("dialog", { name: "Edit the site", exact: true });
    const [title, name] = [edit.getByRole("textbox", { name: "Title", exact: true }), edit.getByRole("textbox", { name: "Name", exact: true })];
    const open = page.getByRole("dialog", { name: SAMPLE.opened, exact: true }).getByRole("button", { name: "Edit", exact: true });
    await open.click();
    const held = [await title.inputValue(), await name.inputValue()];
    await title.fill(DRAFT.title);
    await name.fill(DRAFT.name);
    await expect(edit.getByRole("button", { name: "Save", exact: true })).toBeEnabled();

    await (leave === "Cancel" ? edit.getByRole("button", { name: "Cancel", exact: true }).click() : page.keyboard.press("Escape"));
    await expect(edit).toHaveCount(0);
    await open.click();

    expect([await title.inputValue(), await name.inputValue()]).toEqual(held);
    await expect(edit.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  });
}
