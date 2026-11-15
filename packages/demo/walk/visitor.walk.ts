// The demo as a visitor meets it, in every engine: each test opens a browser that never saw the demo, and names one thing a visitor depends on.

import { expect, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, said, screenHeading, siteLink, siteLinks, TRASH, test, trash, WHAT_IT_IS } from "./visit";

/** The policy every page of the dashboard is answered with. */
const POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** The screens of the dashboard, as paths under the demo: the heading of each, and the thing on it that shows only once its data was read. */
const SCREENS = [
  { path: "", heading: "Sites", holds: { role: "table", name: "Sites" } },
  { path: "tokens", heading: "Access", holds: { role: "table", name: "People" } },
  { path: "activity", heading: "Activity", holds: { role: "table", name: "Activity" } },
  { path: "usage", heading: "Usage", holds: { role: "table", name: "Usage" } },
  { path: "settings", heading: "Settings", holds: { role: "form", name: "Settings" } },
  { path: "domain", heading: "Domain", holds: { role: "heading", name: "First, make a token" } },
  { path: "?view=trash", heading: "Sites", holds: { role: "table", name: "Sites in the trash" } },
] as const;

/** A setting that is typed and then saved with the screen's one Save, and the value a test gives it. */
const SETTING = { label: "Versions kept", value: "5" } as const;

/** A deep link with a query the screen reads and a fragment. */
const DEEP_LINK = "activity?kind=sites#content";

/** Open every screen by its address, and wait until each shows its data. */
async function openEveryScreen(page: Page): Promise<(number | undefined)[]> {
  const statuses: (number | undefined)[] = [];
  for (const screen of SCREENS) {
    statuses.push((await page.goto(`./${screen.path}`))?.status());

    await expect(screenHeading(page, screen.heading), screen.path).toBeVisible();
    await expect(page.getByRole(screen.holds.role, { name: screen.holds.name, exact: true }), screen.path).toBeVisible();
  }

  return statuses;
}

/** Choose the dark theme in the account's menu. */
async function chooseDark(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Account/ }).click();
  await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click();
}

test("the first visit lands on the dashboard with sample sites", async ({ page, baseURL }) => {
  await page.goto("/");
  await expect(siteLinks(page).first()).toBeVisible({ timeout: FIRST_LOAD_MS });

  expect(page.url()).toBe(baseURL);
  expect(await siteLinks(page).count()).toBeGreaterThanOrEqual(5);
});

test("the first screen says that it is a demo, and offers the Reset", async ({ page }) => {
  await arrive(page);

  await expect(page.getByRole("main").getByText("Demo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();
});

test("a page comes from the worker, with the dashboard's own policy", async ({ page }) => {
  await arrive(page);
  const settings = await page.goto("settings");

  expect([settings?.fromServiceWorker(), settings?.status()]).toEqual([true, 200]);
  expect(settings?.headers()["content-security-policy"]).toBe(POLICY);
});

test("the browser enforces that policy: an inline script does not run", async ({ page }) => {
  await arrive(page);
  await page.goto("settings");
  // The policy refuses the tag, so adding it fails; the page itself is then asked whether the script ran.
  await page.addScriptTag({ content: "window.injected = true" }).catch(() => undefined);

  expect(await page.evaluate(() => "injected" in window)).toBe(false);
});

test("every screen answers at its own address, and shows its data", async ({ page }) => {
  await arrive(page);

  expect(await openEveryScreen(page)).toEqual(SCREENS.map(() => 200));
});

test("a change changes the data: a deleted site leaves the list for the trash", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.goto(TRASH);

  await expect(siteLink(page, victim)).toBeVisible();
});

test("a reload keeps the visit", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.goto(TRASH);
  await page.reload();

  await expect(siteLink(page, victim)).toBeVisible();
});

test("a setting typed and saved is still there after a reload", async ({ page }) => {
  await arrive(page);
  await page.goto("settings");
  await page.getByRole("textbox", { name: SETTING.label, exact: true }).fill(SETTING.value);
  await page.getByRole("region", { name: "Unsaved changes", exact: true }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(said(page, "Saved.")).toBeVisible();
  await page.reload();

  await expect(page.getByRole("textbox", { name: SETTING.label, exact: true })).toHaveValue(SETTING.value);
});

test("a sample site is served with every stylesheet it links", async ({ page }) => {
  const [name = ""] = await arrive(page);
  await siteLink(page, name).click();
  // The panel's way to the site is a link drawn as a button, which opens a tab of its own: its address is followed in this one.
  const served = new URL((await page.getByRole("button", { name: "Open the site", exact: true }).getAttribute("href")) ?? "", page.url()).href;
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

test.describe("a browser that asks for the light scheme", () => {
  test.use({ colorScheme: "light" });

  test("the theme chosen in the account's menu holds on the next page", async ({ page }) => {
    await arrive(page);
    await chooseDark(page);
    await page.goto("tokens");
    await expect(screenHeading(page, "Access")).toBeVisible();

    // The theme is a class on the page's root, which every colour of the dashboard is read from.
    await expect(page.locator("html")).toHaveClass(/(^| )dark( |$)/);
  });
});

test("a new visit starts over from the seed", async ({ page, context }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.close();

  // A browser may count a closed tab as open for a moment, so a tab is opened until its visit is a new one. The last one stays open for a failure's screenshot.
  let again = await context.newPage();
  await expect(async () => {
    await again.close();
    again = await context.newPage();

    expect(await arrive(again)).toContain(victim);
  }).toPass({ timeout: FIRST_LOAD_MS });
});

test("the Reset at the top starts over", async ({ page }) => {
  const [victim = ""] = await arrive(page);
  await trash(page, victim);
  await page.getByRole("button", { name: "Reset", exact: true }).click();

  await expect(said(page, "Sample data reset.")).toBeVisible();
  await expect(siteLink(page, victim)).toBeVisible();
});

test("a deep link on a first visit reaches its page, query and fragment kept, through the host's 404 page", async ({ page, baseURL }) => {
  await page.goto(DEEP_LINK);
  await expect(screenHeading(page, "Activity")).toBeVisible({ timeout: FIRST_LOAD_MS });

  expect(page.url()).toBe(`${baseURL}${DEEP_LINK}`);
});

test.describe("a browser with no Service Workers", () => {
  test.use({ serviceWorkers: "block" });

  test("without Service Workers the page says what the product is and why the demo cannot run", async ({ page }) => {
    await page.goto("./");
    await expect(page.getByText("This window cannot run the demo.", { exact: true })).toBeVisible({ timeout: FIRST_LOAD_MS });

    await expect(page.getByRole("heading", { name: WHAT_IT_IS, exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Service Worker");
  });
});

test("nothing asks another origin", async ({ page, seen }) => {
  await arrive(page);
  await openEveryScreen(page);

  expect(seen.elsewhere).toEqual([]);
});

test("no page throws an error", async ({ page, seen }) => {
  await arrive(page);
  await openEveryScreen(page);

  expect(seen.errors).toEqual([]);
});
