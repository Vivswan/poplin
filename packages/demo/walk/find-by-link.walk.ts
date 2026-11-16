// The search over the Sites list: what a person copies from a row's link, or from the browser's bar while a site's panel is open, lists the site it is of when pasted there.

import { expect } from "@playwright/test";

import { arrive, openPanel, siteNames, test } from "./visit";

/** A public and a private sample site, each by what the list calls it. */
const SITES = { public: "Lisbon, four days", private: "Q3 sales report" } as const;

/** The id in a private site's link: after the name, before the letter of its access. */
const ID_IN_LINK = /--([0-9a-z]{12})-p-poplin/;

// Drift: a public site's link shows its public name with the install's ending, and a private one's nothing but its name and its id.
// A search that looked for the pasted text as it stands would find no site by either, and none by an id.
test("a private link, a public link, each also with angle brackets or quotes around it, a bare id, and a public link as the list shows it, pasted into Find a site, each list the one site they are of", async ({ page }) => {
  await arrive(page);
  // The button that opens a site holds the whole link of its row, the id a private row hides too.
  const linkOf = (name: string): Promise<string> => page.locator(`a[aria-label=${JSON.stringify(`Open the site ${name}`)}]:visible`).first().evaluate((link: HTMLAnchorElement) => link.href);
  const [open, hidden] = [await linkOf(SITES.public), await linkOf(SITES.private)];
  const id = ID_IN_LINK.exec(hidden)?.[1] ?? "";
  const find = page.getByRole("searchbox", { name: "Find a site", exact: true });

  // Without both, a paste below would be of no link, or of no id.
  expect([open.endsWith("/lisbon-page/"), id.length, hidden.length > 40]).toEqual([true, 12, true]);

  // Each paste is of another site than the one before it, so a list left as it was fails.
  for (const [pasted, name] of [
    [hidden, SITES.private],
    [open, SITES.public],
    // A mail puts angle brackets around a link, and a person quotes one.
    [`<${hidden}>`, SITES.private],
    [`"${open}"`, SITES.public],
    [id, SITES.private],
    // What the Link column shows of the public site: its first label alone.
    [new URL(open).pathname.split("/").at(-2) ?? "", SITES.public],
  ] as const) {
    // The text is put in as a paste is, so the box may cut it: a private link is longer than a name may be.
    await find.fill("");
    await page.keyboard.insertText(pasted);
    await expect(siteNames(page)).toHaveText([name]);
  }
});

// Drift: the address in the browser's bar while a site's panel is open is the dashboard's own, which the server knows no site by, so the search would find nothing by it.
// And a link that finds no site would be told to check its spelling, with the whole link said back.
test("the address of an open panel, pasted into Find a site with or without angle brackets, lists that panel's site, and a link with an id no site has says that no site is at that link", async ({ page }) => {
  await arrive(page);
  const find = page.getByRole("searchbox", { name: "Find a site", exact: true });
  await openPanel(page, SITES.private);
  await expect(page.getByRole("dialog", { name: SITES.private, exact: true })).toBeVisible();
  const address = page.url();
  await page.keyboard.press("Escape");
  // Without it the paste below would be of no panel.
  expect(address).toMatch(/\/sites\/[0-9a-z-]+--[0-9a-z]{12}$/);

  for (const pasted of [address, `<${address}>`]) {
    // Another site is found first, so a list left as it was fails.
    await find.fill(SITES.public);
    await expect(siteNames(page)).toHaveText([SITES.public]);
    await find.fill("");
    await page.keyboard.insertText(pasted);
    await expect(siteNames(page)).toHaveText([SITES.private]);
  }

  await find.fill("");
  await page.keyboard.insertText(address.replace(/[0-9a-z]{12}$/, "0".repeat(12)));
  await expect(page.locator('[data-slot="empty-title"]')).toHaveText("No site at that link");
  await expect(page.getByText("Check the link, or show all sites.", { exact: true })).toBeVisible();
});
