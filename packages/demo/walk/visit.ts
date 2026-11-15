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

/** The names of the sites the Sites screen lists, each the link that opens its site: in the table of a wide screen and in the list of a narrow one. */
export function siteLinks(page: Page): Locator {
  return page.getByRole("region", { name: "Sites", exact: true }).getByRole("link");
}

/** The link of one site in the list the Sites screen shows. */
export function siteLink(page: Page, name: string): Locator {
  return page.getByRole("region", { name: "Sites", exact: true }).getByRole("link", { name, exact: true });
}

/** The line that says a change was done or refused, by its words. */
export function said(page: Page, words: string): Locator {
  return page.getByRole("region", { name: /^Notifications/ }).getByText(words, { exact: true });
}

/**
 * Open the demo as a browser that never saw it does, and wait for its sites.
 *
 * @returns the names of the sample sites the dashboard lists
 */
export async function arrive(page: Page): Promise<string[]> {
  await page.goto("./");
  await expect(siteLinks(page).first()).toBeVisible({ timeout: FIRST_LOAD_MS });

  return siteLinks(page).allTextContents();
}

/** Move a site to the trash from its row's menu, on the Sites screen, and wait until the dashboard says so and the site has left the list. */
export async function trash(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: `More for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();

  await expect(said(page, `${name} moved to the trash.`)).toBeVisible();
  await expect(siteLink(page, name)).toHaveCount(0);
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
