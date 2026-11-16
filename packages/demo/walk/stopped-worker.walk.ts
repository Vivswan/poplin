// What a visit survives when the browser stops the demo's worker, in Chromium alone: the one engine that lets a test stop a worker and reload a page around it.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, openPanel, screenHeading, siteName, siteNames, TRASH, test, trash } from "./visit";

/** A sample computer whose login waits to be allowed. */
const WAITING = "build-server";

/** What a site's panel says of a label no site has. */
const NO_SITE = "No site is at this address. It may have been deleted, or the link is an old one.";

/** How long a visitor is away from a tab before coming back to it, in milliseconds: longer than a read of the dashboard stands. */
const MINUTE_MS = 60_000;

/** Stop the demo's worker, as a browser does to an idle one. */
async function stopWorker(page: Page): Promise<void> {
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("ServiceWorker.enable");
  await devtools.send("ServiceWorker.stopAllWorkers");
}

/** Drop the demo the worker saved, as the worker of a new build does when it takes an open page over. */
async function dropSaved(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const opening = indexedDB.open("poplin-demo");
    await new Promise((done, failed) => {
      opening.onsuccess = done;
      opening.onerror = failed;
    });
    const dropping = opening.result.transaction("demo", "readwrite").objectStore("demo").delete("saved");
    await new Promise((done, failed) => {
      dropping.onsuccess = done;
      dropping.onerror = failed;
    });
    opening.result.close();
  });
}

/** Mark the page a tab shows now, so a later check tells the page that came back from the one that was there. */
async function markDrawn(page: Page): Promise<void> {
  await page.evaluate(() => document.documentElement.setAttribute("data-before-reload", ""));
}

/** Wait until a tab shows another page than the one that was marked. */
async function loadedAnew(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-before-reload"), undefined, { timeout: FIRST_LOAD_MS });
}

/** The button of an open panel that only a site that is there has. */
function panelOfSite(page: Page): Locator {
  return page.getByRole("dialog").getByRole("button", { name: "Open the site", exact: true });
}

/** The label of the site whose panel a tab's address names. */
function panelLabel(page: Page): string {
  return decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1) ?? "");
}

/** The name a label or a site's address holds before its id. */
function nameOf(label: string): string {
  return label.split("--")[0] ?? "";
}

// Drift: a build published under an open tab starts the demo from the seed, whose sites have other ids than the rows the page drew: a press on a row then opens "No site is at this address".
test("when the demo starts from the seed under an open page, the page loads again by itself and a pressed row's panel shows its site", async ({ page }) => {
  const [, name = ""] = await arrive(page);
  const drawn = await page.evaluate(async () => ((await (await fetch("data/sites")).json()) as { sites: { label: string }[] }).sites.map((site) => site.label));
  await stopWorker(page);
  await dropSaved(page);
  await markDrawn(page);

  await openPanel(page, name);
  await loadedAnew(page);

  await expect(panelOfSite(page)).toBeVisible({ timeout: FIRST_LOAD_MS });
  await expect(page.getByText(NO_SITE)).toHaveCount(0);
  const shown = panelLabel(page);
  expect([drawn.includes(shown), drawn.map(nameOf).includes(nameOf(shown)), shown.includes("--")]).toEqual([false, true, true]);
});

// Drift: the other tab is loaded anew at the address it was first loaded at, the list, and the panel its visitor had open is closed.
// Drift: the browser stops the worker before the other tab asks again, the worker forgets that the tab shows the data of before, and the tab's panel says "No site is at this address".
test("when the demo starts from the seed under two tabs, the other tab comes back to the panel it showed, at the site that holds the name now, a stop of the worker in between or not", async ({ page, context }) => {
  const [, name = ""] = await arrive(page);
  const other = await context.newPage();
  await arrive(other);
  await openPanel(other, name);
  await expect(panelOfSite(other)).toBeVisible();
  const before = panelLabel(other);
  await stopWorker(page);
  await dropSaved(page);
  await markDrawn(page);
  await markDrawn(other);

  await openPanel(page, name);
  await loadedAnew(page);
  // The browser stops the idle worker before the visitor comes back to the other tab. That is a minute later, when what the tab read has grown old, so the dashboard reads its data again.
  await stopWorker(page);
  await other.clock.setFixedTime(Date.now() + MINUTE_MS);
  await other.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await loadedAnew(other);

  await expect(panelOfSite(other)).toBeVisible({ timeout: FIRST_LOAD_MS });
  await expect(other.getByText(NO_SITE)).toHaveCount(0);
  expect([panelLabel(other) === before, nameOf(panelLabel(other))]).toEqual([false, nameOf(before)]);
});

// Drift: a sample site open in a tab of its own is loaded anew at its old address, which no site answers at, and its visitor is left on Not found.
test("when the demo starts from the seed, a sample site's tab keeps its page, and a reload of it leads to the site that holds the name now", async ({ page, context }) => {
  const names = await arrive(page);
  const links = await Promise.all(names.map((name) => siteName(page, name).getAttribute("href")));
  const served = new URL(links.find((link) => link?.includes("--") === true) ?? "", page.url()).href;
  const site = await context.newPage();
  await site.goto(served);
  const title = await site.title();
  await stopWorker(page);
  await dropSaved(page);
  await markDrawn(page);
  await markDrawn(site);

  await openPanel(page, names[1] ?? "");
  await loadedAnew(page);
  await expect(panelOfSite(page)).toBeVisible({ timeout: FIRST_LOAD_MS });
  const kept = await site.evaluate(() => document.documentElement.hasAttribute("data-before-reload"));
  const answer = await site.reload();

  const label = (address: string): string => new URL(address).pathname.split("/").at(-2) ?? "";
  expect([kept, answer?.status(), await site.title()]).toEqual([true, 200, title]);
  expect([site.url() === served, nameOf(label(site.url()))]).toEqual([false, nameOf(label(served))]);
});

// Drift: a reload of one tab starts the demo from the seed, and the other tab's rows keep the ids of the data before: a press on one opens "No site is at this address".
test("when a reload of one tab starts the demo from the seed, a pressed row of the other tab still opens its site", async ({ page, context }) => {
  const [, name = ""] = await arrive(page);
  const other = await context.newPage();
  await arrive(other);
  await stopWorker(page);
  await dropSaved(page);
  await markDrawn(other);

  await page.reload();
  await expect(siteNames(page).first()).toBeVisible({ timeout: FIRST_LOAD_MS });
  await openPanel(other, name);
  await loadedAnew(other);

  await expect(panelOfSite(other)).toBeVisible({ timeout: FIRST_LOAD_MS });
  await expect(other.getByText(NO_SITE)).toHaveCount(0);
});

test("after the browser stops the worker, an open page's change still works and nothing is lost", async ({ page }) => {
  const [victim = "", second = ""] = await arrive(page);
  await trash(page, victim);
  await stopWorker(page);

  // The page was drawn before the stop: its change is answered by a worker that starts from what was saved.
  await trash(page, second);
  await page.goto(TRASH);

  await expect(siteName(page, victim)).toBeVisible();
  await expect(siteName(page, second)).toBeVisible();
});

test("a saved demo survives a stop of the worker and a reload", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.goto(TRASH);
  await expect(siteNames(page).first()).toBeVisible();
  await stopWorker(page);
  await page.reload();

  await expect(siteName(page, victim)).toBeVisible();
});

// Drift: the worker that starts again would begin its sample logins anew, and the one the screen lists would no longer wait.
test("a login listed before the browser stops the worker can still be reviewed after it", async ({ page }) => {
  await arrive(page);
  await page.goto("tokens/list");
  const review = page.getByRole("row").filter({ hasText: WAITING }).getByRole("button", { name: "Review", exact: true });
  await expect(review).toBeVisible();
  await stopWorker(page);
  await review.click();

  await expect(page.getByRole("dialog", { name: "Allow this login?", exact: true }).getByRole("textbox", { name: "Last 4 letters of the code in your terminal", exact: true })).toBeVisible();
});

test("a forced reload of a deep page, around the worker, comes back to it", async ({ page, baseURL }) => {
  await arrive(page);
  await page.goto("activity");
  const devtools = await page.context().newCDPSession(page);

  await markDrawn(page);
  await devtools.send("Page.reload", { ignoreCache: true });
  await loadedAnew(page);

  await expect(screenHeading(page, "Activity")).toBeVisible({ timeout: FIRST_LOAD_MS });
  expect(page.url()).toBe(`${baseURL}activity`);
});
