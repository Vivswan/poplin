// The two buttons that read one thing again: the list of sites, and the visits graph. Each reads its own thing and nothing else, and says how old what it shows is.

import { expect, type Page } from "@playwright/test";

import { arrive, test, toSection } from "./visit";

/** How long the page's clock is moved on, in milliseconds, and how long the words may take to follow it: they are written anew every ten seconds. */
const [LATER_MS, WORDS_MS] = [3 * 60_000, 15_000] as const;

/** Press a button and say which of the data routes the page then asked, each by its path after `data/` and its query. */
async function askedAt(page: Page, button: string): Promise<readonly string[]> {
  const asked: string[] = [];
  const note = (request: { url(): string }): void => {
    const { pathname, search } = new URL(request.url());
    const [, route] = pathname.split("/data/");
    if (route !== undefined) asked.push(`${route}${search}`);
  };
  page.on("request", note);
  const answered = page.waitForResponse((response) => response.url().includes("/data/"));
  await page.getByRole("button", { name: button, exact: true }).click();
  await answered;
  // A read the press started by mistake would be asked in the same moment: the page is given one more to ask it in.
  await page.waitForTimeout(300);
  page.off("request", note);

  return asked;
}

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  // Drift: the button would read nothing; or read the whole screen; or its words would keep saying "just now" of a list read minutes ago.
  test("the button of the list of sites reads the list alone, and its words follow the clock", async ({ page }) => {
    await arrive(page);
    const words = page.getByText(/^Updated /);
    await expect(words).toHaveText("Updated just now");

    await page.clock.setFixedTime(Date.now() + LATER_MS);
    await expect(words).toHaveText("Updated 3 minutes ago", { timeout: WORDS_MS });

    expect(await askedAt(page, "Refresh the list")).toEqual(["sites"]);
    await expect(words).toHaveText("Updated just now", { timeout: WORDS_MS });
  });

  // Drift: the graph's days stand half an hour: with no button of its own there would be no way to read them sooner, and a button that read the rows under the graph too would not be the graph's.
  test("the button of the visits graph reads the graph alone", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Usage");
    await expect(page.getByRole("region", { name: "Visits", exact: true }).getByText(/^Updated /)).toBeVisible();

    expect(await askedAt(page, "Refresh the graph")).toEqual(["usage/visits?range=30"]);
  });
});
