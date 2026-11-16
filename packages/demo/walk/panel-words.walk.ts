// What a site's panel and the trash say where they said nothing, or named no site: an emptied name in Edit, and a site put back from the trash.

import { expect } from "@playwright/test";

import { arrive, openPanel, said, siteNames, TRASH, test, trash } from "./visit";

// Drift: with the name emptied, Save is off and Enter does nothing. A dialog that says nothing then leaves a person pressing a dead button, where a name of two letters is told its rule.
test("Edit with the name emptied says under the field that a site needs a name, and Save is off", async ({ page }) => {
  const [first = ""] = await arrive(page);
  await openPanel(page, first);
  await page.getByRole("dialog", { name: first, exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: /^Edit/u });
  const name = edit.getByRole("textbox", { name: "Name", exact: true });

  await name.fill("");
  await name.press("Enter");
  await expect(edit.getByText("A site needs a name.", { exact: true })).toBeVisible();
  await expect(edit.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await expect(edit).toBeVisible();
});

// Drift: the line of a site put back would say "Restored from the trash." of no site again, where the line of its delete names it; with two sites in the trash a person could not tell which one came back.
test("Restore in a row of the trash says which site is back, as the line of its delete named it", async ({ page }) => {
  const [first = ""] = await arrive(page);
  await trash(page, first);
  await page.goto(TRASH);
  await expect(siteNames(page).first()).toBeVisible();

  await page.getByRole("button", { name: `Restore ${first}`, exact: true }).click();
  await expect(said(page, `${first} restored.`)).toBeVisible();
});
