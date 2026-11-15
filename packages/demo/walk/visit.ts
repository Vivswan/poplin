// What every test of the walk shares: a visitor's browser that is watched, and the steps more than one test takes.

import { type BrowserContext, test as base, expect, type Locator, type Page } from "@playwright/test";

/** The sentence a stranger reads where the demo cannot run. */
export const WHAT_IT_IS = "Your agent publishes a folder as a website, in your own account.";

/** How long the first load may take, in milliseconds: the worker installs, SQLite loads, and the seed runs. */
export const FIRST_LOAD_MS = 30_000;

/** The address of the Sites screen when it shows the trash. */
export const TRASH = "./?view=trash";

/** What a visitor's browser did that no page of the demo may do. */
interface Seen {
  /** The errors its pages threw. */
  readonly errors: string[];

  /** The addresses it asked at any origin but the demo's. */
  readonly elsewhere: string[];
}

/** Watch a browser for a page's own error, and for a request to any origin but the demo's. */
function watch(context: BrowserContext, origin: string): Seen {
  const seen: Seen = { errors: [], elsewhere: [] };
  context.on("weberror", (error) => seen.errors.push(String(error.error())));
  context.on("request", (request) => {
    if (!request.url().startsWith(`${origin}/`)) seen.elsewhere.push(request.url());
  });

  return seen;
}

/** The heading of the screen a page shows. */
export function screenHeading(page: Page, name: string): Locator {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

/** The sites the Sites screen lists, each by what the list calls it: in the table of a wide screen and in the list of a narrow one. A site that is served has a link there, which opens the site; a site in the trash has plain words. */
export function siteNames(page: Page): Locator {
  return page.getByRole("region", { name: "Sites", exact: true }).locator('[data-slot="site-name"]:visible');
}

/** One site in the list the Sites screen shows, by what the list calls the site. */
export function siteName(page: Page, name: string): Locator {
  return page.getByRole("region", { name: "Sites", exact: true }).locator(`[data-slot="site-name"][title=${JSON.stringify(name)}]:visible`);
}

/** Open a site's panel: a press on its row beside the title. A wide screen's row says there who can open the site; a narrow screen's row has a button of its own under its words. */
export async function openPanel(page: Page, name: string): Promise<void> {
  const list = page.getByRole("region", { name: "Sites", exact: true });
  const details = list.getByRole("button", { name: `Details of ${name}`, exact: true });
  // The button lies under the row's words and controls: the press lands in the row's own corner, where nothing lies over it.
  if (await details.isVisible()) return details.click({ position: { x: 6, y: 6 } });

  await list
    .getByRole("row")
    .filter({ has: page.locator(`[data-slot="site-name"][title=${JSON.stringify(name)}]`) })
    .getByText(/^(Private|Unlisted|Public)$/)
    .click();
}

/** The line that says a change was done or refused, by its words. */
export function said(page: Page, words: string): Locator {
  return page.getByRole("region", { name: /^Notifications/ }).getByText(words, { exact: true });
}

/**
 * Open the demo as a browser that never saw it does, and wait for its sites.
 *
 * @returns what the dashboard calls each sample site it lists: the site's title, or its name where it has none
 */
export async function arrive(page: Page): Promise<string[]> {
  await page.goto("./");
  await expect(siteNames(page).first()).toBeVisible({ timeout: FIRST_LOAD_MS });

  return siteNames(page).allTextContents();
}

/** Move a site to the trash from its row's menu, on the Sites screen, and wait until the dashboard says so and the site has left the list. */
export async function trash(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `More for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();

  await expect(said(page, `${name} moved to the trash.`)).toBeVisible();
  await expect(siteName(page, name)).toHaveCount(0);
}

/** A test whose browser is watched: it fails when a page threw an error or asked another origin, whatever else it checks. */
export const test = base.extend<{ seen: Seen }>({
  seen: [
    async ({ context, baseURL }, use) => {
      const seen = watch(context, new URL(baseURL ?? "").origin);
      await use(seen);

      expect(seen).toEqual({ errors: [], elsewhere: [] });
    },
    { auto: true },
  ],
});
