// What every test of the walk shares: a visitor's browser that is watched, and the steps more than one test takes.

import { type BrowserContext, test as base, expect, type Page } from "@playwright/test";

/** A link to a site's page in the dashboard. */
export const SITE_LINK = 'main a[href*="/sites/"]';

/** The button of the form that moves a site to the trash. */
export const TRASH_BUTTON = 'form[action$="/delete"] button[type="submit"]';

/** What the product's pages say when a form was refused. */
export const REFUSED = "Not done";

/** A dashboard page whose browser chose the dark scheme. */
export const SHOWN_DARK = 'html[data-theme="dark"]';

/** The line at the top of a dashboard page that says it is a demo, with its Reset. */
export const DEMO_LINE = "main .demo";

/** The sentence a stranger reads where the demo cannot run. */
export const WHAT_IT_IS = "Your agent publishes a folder as a website, in your own account.";

/** How long the first load may take, in milliseconds: the worker installs, SQLite loads, and the seed runs. */
export const FIRST_LOAD_MS = 30_000;

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

/** The names of the sites a dashboard page lists. */
export async function siteNames(page: Page): Promise<string[]> {
  return page.locator(SITE_LINK).allTextContents();
}

/**
 * Open the demo as a browser that never saw it does, and wait for its dashboard.
 *
 * @returns the names of the sample sites the dashboard lists
 */
export async function arrive(page: Page): Promise<string[]> {
  await page.goto("./");
  await page.waitForSelector(SITE_LINK, { timeout: FIRST_LOAD_MS });

  return siteNames(page);
}

/**
 * Open a site's page in the dashboard and send its trash form.
 *
 * @returns the page the form answered with
 */
export async function trash(page: Page, name: string): Promise<string> {
  await page.goto("./");
  await page.click(`${SITE_LINK}:text-is("${name}")`);
  await page.click(TRASH_BUTTON);
  await page.waitForLoadState();

  return page.content();
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
