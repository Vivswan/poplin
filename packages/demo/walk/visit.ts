// What every test of the walk shares: a visitor's browser that is watched, and the steps more than one test takes.

import { type BrowserContext, test as base, expect, type Locator, type Page } from "@playwright/test";

/** The sentence a stranger reads where the demo cannot run. */
export const WHAT_IT_IS = "Your agent publishes a folder as a website, in your own account.";

/** How long the first load may take, in milliseconds: the worker installs, SQLite loads, and the seed runs. */
export const FIRST_LOAD_MS = 30_000;

/** How long a Reset may take to say that it is done, in milliseconds: the worker seeds both installs again and the open screen reads its data again before the line shows, which on a busy machine passes the five seconds a wait gets. */
const RESET_MS = 30_000;

/** What the dashboard says once the sample data is new again. */
const RESET_DONE = "Sample data reset.";

/** What the dashboard says when the sample data could not be made new. The line leaves after a few seconds. */
const RESET_REFUSED = "The sample data was not reset. Try again.";

/** WebKit's line for a request by script that ended with no answer, which it reports as an error of the page. The address is the request's. */
const NO_ANSWER = /^Fetch API cannot load (\S+) due to access control checks\.$/m;

/** The name of the button that opens the sections on a narrow screen: it says how many problems the sections hold, where they hold any. */
export const SECTIONS_BUTTON = /^Sections(, \d+ problems?)?$/;

/** The address of the Sites screen when it shows the trash. */
export const TRASH = "./?view=trash";

/** What a visitor's browser did that no page of the demo may do. */
interface Seen {
  /** The errors its pages threw. */
  readonly errors: string[];

  /** The addresses it asked at any origin but the demo's. */
  readonly elsewhere: string[];
}

/** A watched browser: what it did that fails a test, and what else went wrong in it, which a failed test prints. */
interface Watched {
  readonly seen: Seen;
  readonly besides: string[];
}

/**
 * Whether an error a page reported is WebKit's line for a request to the demo's own origin that ended with no answer: a page that is reloaded or left while it still loads has such a request.
 *
 * The line does not say why the request ended. One that the demo left unanswered shows in what its step looks for on the screen.
 */
export function isUnanswered(error: Error, origin: string): boolean {
  const address = NO_ANSWER.exec(`${error.message}\n${error.stack ?? ""}`)?.[1] ?? "";

  return address.startsWith(`${origin}/`);
}

/** Watch a browser for an error a script of a page threw, and for a request to any origin but the demo's. */
function watch(context: BrowserContext, origin: string): Watched {
  const seen: Seen = { errors: [], elsewhere: [] };
  const besides: string[] = [];
  context.on("weberror", (thrown) => {
    const error = thrown.error();
    besides.push(`reported on ${thrown.page()?.url()}: ${error.stack || String(error)}`);
    if (!isUnanswered(error, origin)) seen.errors.push(String(error));
  });
  context.on("request", (request) => {
    if (!request.url().startsWith(`${origin}/`)) seen.elsewhere.push(request.url());
  });
  context.on("requestfailed", (request) => besides.push(`failed, ${request.failure()?.errorText}: ${request.resourceType()} ${request.url()}`));
  context.on("response", (response) => {
    if (response.status() >= 400) besides.push(`answered ${response.status()}: ${response.request().resourceType()} ${response.url()}`);
  });

  return { seen, besides };
}

/**
 * A part of the page by its role, also under an open panel: a panel hides the rest of the page from a screen reader for as long as it is open, and a pointer still reaches it.
 *
 * Of two parts with one name, as the sections at the side and in a phone's sheet, it is the one in sight.
 */
export function onPage(within: Page | Locator, role: Parameters<Page["getByRole"]>[0], named: Parameters<Page["getByRole"]>[1] = {}): Locator {
  return within.getByRole(role, { ...named, includeHidden: true }).filter({ visible: true });
}

/** The heading of the screen a page shows. */
export function screenHeading(page: Page, name: string): Locator {
  return onPage(page, "heading", { level: 1, name, exact: true });
}

/** The sites the Sites screen lists, each by what the list calls it: in the table of a wide screen and in the list of a narrow one. A site that is served has a link there, which opens the site; a site in the trash has plain words. */
export function siteNames(page: Page): Locator {
  return onPage(page, "region", { name: "Sites", exact: true }).locator('[data-slot="site-name"]:visible');
}

/** One site in the list the Sites screen shows, by what the list calls the site. */
export function siteName(page: Page, name: string): Locator {
  return onPage(page, "region", { name: "Sites", exact: true }).locator(`[data-slot="site-name"][title=${JSON.stringify(name)}]:visible`);
}

/** Open a site's panel: a press on its row beside the title. A wide screen's row says there who can open the site; a narrow screen's row has a button of its own under its words. */
export async function openPanel(page: Page, name: string): Promise<void> {
  const list = onPage(page, "region", { name: "Sites", exact: true });
  const row = onPage(list, "row").filter({ has: page.locator(`[data-slot="site-name"][title=${JSON.stringify(name)}]`) });
  if (await row.isVisible()) return row.getByText(/^(Private|Unlisted|Public)$/).click();

  // On a phone the button lies under the row's words and controls: the press lands in the row's own corner, where nothing lies over it.
  await list.getByRole("listitem").getByRole("button", { name: `Details of ${name}`, exact: true }).click({ position: { x: 6, y: 6 } });
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

/** Go to a section by its entry at the side, which a narrow screen keeps behind a button. A section whose screen holds a problem says how many after its name. */
export async function toSection(page: Page, label: string): Promise<void> {
  const behind = onPage(page, "button", { name: SECTIONS_BUTTON });
  if (await behind.isVisible()) await behind.click();

  await onPage(onPage(page, "navigation", { name: "Sections", exact: true }), "link", { name: new RegExp(`^${label}( \\d+ problems?)?$`) }).click();
}

/** Move a site to the trash from its panel, on the Sites screen, and wait until the dashboard says so and the site has left the list. */
export async function trash(page: Page, name: string): Promise<void> {
  await openPanel(page, name);
  await page.getByRole("dialog", { name, exact: true }).getByRole("button", { name: "Delete", exact: true }).click();

  await expect(said(page, `${name} moved to the trash.`)).toBeVisible();
  await expect(siteName(page, name)).toHaveCount(0);
}

/** Press Reset and wait until the dashboard says the sample data is new. A reset the dashboard says failed ends the wait at once, under the words it said. */
export async function reset(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Reset", exact: true }).click();

  const answer = said(page, RESET_DONE).or(said(page, RESET_REFUSED)).first();
  await expect(answer).toBeVisible({ timeout: RESET_MS });
  expect(await answer.textContent(), "what the dashboard said of the reset").toBe(RESET_DONE);
}

/** A test whose browser is watched: it fails when a page threw an error or asked another origin, whatever else it checks. */
export const test = base.extend<{ seen: Seen }>({
  seen: [
    async ({ context, baseURL }, use) => {
      const { seen, besides } = watch(context, new URL(baseURL ?? "").origin);
      await use(seen);

      expect(seen, `what else went wrong in the browser:\n${besides.join("\n")}`).toEqual({ errors: [], elsewhere: [] });
    },
    { auto: true },
  ],
});
