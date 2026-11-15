// What a visit survives when the browser stops the demo's worker, in Chromium alone: the one engine that lets a test stop a worker and reload a page around it.

import { expect, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, openPanel, screenHeading, siteName, siteNames, TRASH, test, trash } from "./visit";

/** A sample computer whose login waits to be allowed. */
const WAITING = "build-server";

/** What a site's panel says of a label no site has. */
const NO_SITE = "No site is at this address. It may have been deleted, or the link is an old one.";

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

// Drift: a build published under an open tab starts the demo from the seed, whose sites have other ids than the rows the page drew: a press on a row then opens "No site is at this address".
test("when the demo starts from the seed under an open page, the page loads again by itself and a pressed row's panel shows its site", async ({ page }) => {
  const [, name = ""] = await arrive(page);
  const drawn = await page.evaluate(async () => ((await (await fetch("data/sites")).json()) as { sites: { label: string }[] }).sites.map((site) => site.label));
  await stopWorker(page);
  await dropSaved(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-before-reload", ""));

  await openPanel(page, name);
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-before-reload"), undefined, { timeout: FIRST_LOAD_MS });

  await expect(page.getByRole("dialog").getByRole("button", { name: "Open the site", exact: true })).toBeVisible({ timeout: FIRST_LOAD_MS });
  await expect(page.getByText(NO_SITE)).toHaveCount(0);
  const shown = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1) ?? "");
  const named = (label: string): string => label.split("--")[0] ?? "";
  expect([drawn.includes(shown), drawn.map(named).includes(named(shown)), shown.includes("--")]).toEqual([false, true, true]);
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

  // The page before the reload is marked, so the check looks at the page that came back and never at the one that was there.
  await page.evaluate(() => document.documentElement.setAttribute("data-before-reload", ""));
  await devtools.send("Page.reload", { ignoreCache: true });
  await page.waitForFunction(() => !document.documentElement.hasAttribute("data-before-reload"), undefined, { timeout: FIRST_LOAD_MS });

  await expect(screenHeading(page, "Activity")).toBeVisible({ timeout: FIRST_LOAD_MS });
  expect(page.url()).toBe(`${baseURL}activity`);
});
