// The demo as a visitor meets it, in every engine: each test opens a browser that never saw the demo, and names one thing a visitor depends on.

import { expect } from "@playwright/test";

import { arrive, DEMO_LINE, FIRST_LOAD_MS, REFUSED, SHOWN_DARK, SITE_LINK, siteNames, test, trash, WHAT_IT_IS } from "./visit";

/** The pages of the dashboard a visitor reaches from its own navigation, as paths under the demo. */
const TABS = ["", "tokens", "settings", "activity", "usage", "domain", "?view=trash"];

/** A link to a site as it is served. */
const SERVED_LINK = 'main a[href*="/served/"]';

/** The name a test gives the copy of a site. */
const COPY_NAME = "walk-copy";

/** The button of the dashboard's choice of scheme that takes the dark one. */
const DARK_BUTTON = 'form[action$="/theme"] button[value="dark"]';

test("the first visit lands on the dashboard with sample sites", async ({ page, baseURL }) => {
  await page.goto("/");
  await page.waitForSelector(SITE_LINK, { timeout: FIRST_LOAD_MS });

  expect(page.url()).toBe(baseURL);
  expect((await siteNames(page)).length).toBeGreaterThanOrEqual(5);
});

test("the first screen says at its top that it is a demo", async ({ page }) => {
  await arrive(page);

  await expect(page.locator(DEMO_LINE)).toContainText("sample data, resets");
});

test("a page comes from the worker, with the dashboard's own policy", async ({ page }) => {
  await arrive(page);
  const settings = await page.goto("settings");

  expect([settings?.fromServiceWorker(), settings?.status()]).toEqual([true, 200]);
  expect(settings?.headers()["content-security-policy"]).toContain("default-src 'none'");
});

test("the browser enforces that policy: an inline script does not run", async ({ page }) => {
  await arrive(page);
  await page.goto("settings");
  // The policy refuses the tag, so adding it fails; the page itself is then asked whether the script ran.
  await page.addScriptTag({ content: "window.injected = true" }).catch(() => undefined);

  expect(await page.evaluate(() => "injected" in window)).toBe(false);
});

test("every tab answers", async ({ page }) => {
  await arrive(page);
  const statuses: (readonly [string, number | undefined])[] = [];
  for (const tab of TABS) statuses.push([tab, (await page.goto(`./${tab}`))?.status()]);

  expect(statuses).toEqual(TABS.map((tab) => [tab, 200]));
});

test("a form changes the data: a site moves to the trash", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  const after = await trash(page, victim);
  await page.goto("./");
  const left = await siteNames(page);
  await page.goto("./?view=trash");

  expect(after).not.toContain(REFUSED);
  expect(left).not.toContain(victim);
  expect(await siteNames(page)).toContain(victim);
});

test("a reload keeps the visit", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.goto("./?view=trash");
  await page.reload();

  expect(await siteNames(page)).toContain(victim);
});

test("a site is duplicated: the copy is listed under its own name", async ({ page }) => {
  const [copied = ""] = await arrive(page);
  await page.click(`${SITE_LINK}:text-is("${copied}")`);
  await page.click('.panel a[href*="ask=duplicate"]');
  await page.fill('form[action$="/duplicate"] input[name="name"]', COPY_NAME);
  await page.click('form[action$="/duplicate"] button[type="submit"]');
  await page.waitForLoadState();
  await page.goto("./");

  expect(await siteNames(page)).toContain(COPY_NAME);
});

test("the settings form, with every field of it, is taken", async ({ page, baseURL }) => {
  await arrive(page);
  await page.goto("settings");
  await page.click('form[action$="/settings/save"] button[type="submit"]');
  await page.waitForLoadState();

  expect(page.url()).toContain(`${baseURL}settings`);
  expect(await page.content()).not.toContain(REFUSED);
});

test("a sample site is served with every stylesheet it links", async ({ page }) => {
  await arrive(page);
  const served = new URL((await page.locator(SERVED_LINK).first().getAttribute("href")) ?? "", page.url()).href;
  const answer = await page.goto(served);
  const linked = await page.locator('link[rel="stylesheet"]').count();
  const sheets = await page.evaluate(() => [...document.styleSheets].filter((sheet) => sheet.href !== null && sheet.cssRules.length > 0).length);

  expect(answer?.status()).toBe(200);
  expect(linked).toBeGreaterThanOrEqual(1);
  expect(sheets).toBe(linked);
});

test("a page outside the demo's folder stays the host's own", async ({ page, context }) => {
  await arrive(page);
  // In a tab of its own: the demo's last tab leaving the demo would end the visit.
  const beside = await context.newPage();
  const outside = await beside.goto("/another-page/");

  expect([outside?.fromServiceWorker(), outside?.status()]).toEqual([false, 404]);
});

test("the choice of scheme holds on the next page: the worker keeps the cookie", async ({ page }) => {
  await arrive(page);
  await page.click(DARK_BUTTON);
  await page.waitForLoadState();
  await page.goto("tokens");

  await expect(page.locator(SHOWN_DARK)).toHaveCount(1);
});

test("a new visit starts over from the seed", async ({ page, context }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.goto("./");
  await page.click(DARK_BUTTON);
  await page.waitForLoadState();
  await page.close();

  // A browser may count a closed tab as open for a moment, so a tab is opened until its visit is a new one. The last one stays open for a failure's screenshot.
  let again = await context.newPage();
  await expect(async () => {
    await again.close();
    again = await context.newPage();

    expect(await arrive(again)).toContain(victim);
    expect(await again.locator(SHOWN_DARK).count()).toBe(0);
  }).toPass({ timeout: FIRST_LOAD_MS });
});

test("the Reset at the top starts over", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.click(`${DEMO_LINE} form[action$="/reset"] button`);
  await page.waitForSelector(SITE_LINK);

  expect(await siteNames(page)).toContain(victim);
});

test("a deep link on a first visit reaches its page, query and fragment kept, through the host's 404 page", async ({ page, baseURL }) => {
  await page.goto("activity?page=1#content");
  await page.waitForSelector(DEMO_LINE, { timeout: FIRST_LOAD_MS });

  expect(page.url()).toBe(`${baseURL}activity?page=1#content`);
});

test.describe("a browser with no Service Workers", () => {
  test.use({ serviceWorkers: "block" });

  test("without Service Workers the page says what the product is and why the demo cannot run", async ({ page }) => {
    await page.goto("./");
    await page.waitForSelector("#blocked:not([hidden])", { timeout: FIRST_LOAD_MS });

    await expect(page.locator("main")).toContainText(WHAT_IT_IS);
    await expect(page.locator("main")).toContainText("Service Worker");
  });
});

test("nothing asks another origin", async ({ page, seen }) => {
  await arrive(page);
  for (const tab of TABS) await page.goto(`./${tab}`);

  expect(seen.elsewhere).toEqual([]);
});

test("no page throws an error", async ({ page, seen }) => {
  await arrive(page);
  for (const tab of TABS) await page.goto(`./${tab}`);

  expect(seen.errors).toEqual([]);
});
