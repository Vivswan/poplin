// What a visit survives when the browser stops the demo's worker, in Chromium alone: the one engine that lets a test stop a worker and reload a page around it.

import { expect, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, REFUSED, SITE_LINK, siteNames, TRASH_BUTTON, test, trash } from "./visit";

/** Stop the demo's worker, as a browser does to an idle one. */
async function stopWorker(page: Page): Promise<void> {
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("ServiceWorker.enable");
  await devtools.send("ServiceWorker.stopAllWorkers");
}

test("after the browser stops the worker, an open page's form still works and nothing is lost", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.goto("./");
  const [second = ""] = await siteNames(page);
  await page.click(`${SITE_LINK}:text-is("${second}")`);
  await page.waitForLoadState();
  await stopWorker(page);

  // The page was drawn before the stop: its form carries a token signed before it.
  await page.click(TRASH_BUTTON);
  await page.waitForLoadState();
  const after = await page.content();
  await page.goto("./?view=trash");

  expect(after).not.toContain(REFUSED);
  expect(await siteNames(page)).toEqual(expect.arrayContaining([victim, second]));
});

test("a saved demo survives a stop of the worker and a reload", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.goto("./?view=trash");
  await stopWorker(page);
  await page.reload();

  expect(await siteNames(page)).toContain(victim);
});

test("a forced reload of a deep page, around the worker, comes back to it", async ({ page, baseURL }) => {
  await arrive(page);
  await page.goto("activity");
  const devtools = await page.context().newCDPSession(page);

  // The page before the reload is marked, so the check looks at the page that came back and never at the one that was there.
  await page.evaluate(() => document.documentElement.setAttribute("data-before-reload", ""));
  await devtools.send("Page.reload", { ignoreCache: true });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-before-reload") && document.querySelector("main .demo") !== null, undefined, { timeout: FIRST_LOAD_MS });

  expect(page.url()).toBe(`${baseURL}activity`);
  expect(await page.title()).toMatch(/^Activity/);
});
