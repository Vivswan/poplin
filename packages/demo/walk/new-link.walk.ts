// "New link" takes a leaked address back: the old link opens nothing, and no address with a made-up id leads to the site.

import { expect, type Page } from "@playwright/test";

import { arrive, openPanel, said, siteName, test } from "./visit";

/** The sample site a link alone opens. */
const UNLISTED = "Pricing";

/** An id of the right form that no site has. */
const MADE_UP = "aaaaaaaaaaaa";

/** Ask an address as a browser that follows redirects does, and answer the status and where it ended. */
async function ask(page: Page, address: string): Promise<{ readonly status: number; readonly at: string }> {
  return page.evaluate(async (asked) => {
    const answer = await fetch(asked);

    return { status: answer.status, at: answer.url };
  }, address);
}

// Drift: the demo led every address with an id no site has on to the site of that name, so the link from before "New link", or any guessed one, opened the site at its new secret link, under a line that says the old link stopped working.
test("after New link the old link and a made-up one answer that nothing is there, and the new link opens the site", async ({ page }) => {
  await arrive(page);
  const old = (await siteName(page, UNLISTED).getAttribute("href")) ?? "";
  await openPanel(page, UNLISTED);
  await page.getByRole("dialog", { name: UNLISTED, exact: true }).getByRole("button", { name: "New link", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Make a new link?", exact: true }).getByRole("button", { name: "Make a new link", exact: true }).click();
  await expect(said(page, "The site has a new link. The old link stopped working.")).toBeVisible();
  await expect(siteName(page, UNLISTED)).not.toHaveAttribute("href", old);
  const now = (await siteName(page, UNLISTED).getAttribute("href")) ?? "";
  const [, id = ""] = /--([a-z0-9]+)-u-/u.exec(now) ?? [];
  const guessed = now.replace(id, MADE_UP);

  const answers = [await ask(page, old), await ask(page, guessed), await ask(page, now)];

  expect([id.length > 0, guessed !== now, answers.map((answer) => answer.status), answers.slice(0, 2).some((answer) => answer.at.includes(id))]).toEqual([true, true, [404, 404, 200], false]);
});
