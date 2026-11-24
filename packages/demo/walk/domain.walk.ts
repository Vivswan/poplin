// The Domain screen of an install that holds what reads its provider: what it shows as it opens, when it checks again by itself, and that Check asks for nothing. And a problem a repair mends, which leaves once the repair is done.
// And the copy of the whole status, as plain text.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, ownClipboard, said, screenHeading, test, toSection } from "./visit";

/** How far the reader's clock is moved on between two openings of the screen: past the 10 minutes a check is gone by. */
const PAST_FRESH = "11:00";

/** The sample install's problem of the domain, which a repair mends: what it says. */
const MENDED_BY_REPAIR = "A change of the users or the alerts did not take effect";

/** The line at the top of the Domain screen, by what it says. */
function domainLine(page: Page, says: string): Locator {
  return page.getByRole("status").filter({ hasText: says });
}

// Drift: the install holds what reads its provider, so Domain would ask for a press and a token it has no use for, rest on a check from another day, or open the token's dialog at Check.
test("Domain opens on its pieces with no press and no token; opened again once the check is over ten minutes old it checks by itself, and Check asks for nothing", async ({ page }) => {
  await page.clock.install();
  await arrive(page);
  const asked = page.getByRole("dialog");
  await toSection(page, "Domain");
  await expect(domainLine(page, "1 to repair")).toBeVisible();
  await expect(page.getByRole("table", { name: "Pieces", exact: true }).getByRole("row").nth(1)).toBeVisible();
  await expect(asked).toHaveCount(0);

  await toSection(page, "Settings");
  // Domain stays drawn until the code of Settings has loaded. A press on Domain before that opens nothing again.
  await expect(screenHeading(page, "Settings")).toBeVisible();
  await page.clock.fastForward(PAST_FRESH);
  await toSection(page, "Domain");
  await expect(domainLine(page, "3 to repair")).toBeVisible();
  await expect(asked).toHaveCount(0);

  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(said(page, "3 to repair.")).toBeVisible();
  await expect(asked).toHaveCount(0);
});

// Drift: a problem that says "press Repair" would stay on the screen and at the side for a day after the repair was done, asking for what a person just did; or a check, which mends nothing of it, would take it away.
test("a problem a repair mends stays through a check, and leaves the Domain screen and the side once the repair is done", async ({ page }) => {
  await arrive(page);
  const sections = page.getByRole("navigation", { name: "Sections", exact: true });
  const problem = page.getByRole("group", { name: MENDED_BY_REPAIR, exact: true });
  await toSection(page, "Domain");
  await expect(problem).toBeVisible();

  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(said(page, "3 to repair.")).toBeVisible();
  // The side counts what the check left to do beside the problem: once it says two, the screen holds what was read after the check.
  await expect(sections.getByRole("link", { name: "Domain 2 problems", exact: true })).toBeVisible();
  await expect(problem).toBeVisible();

  const asked = page.getByRole("dialog", { name: "Repair the domain", exact: true });
  await page.getByRole("button", { name: "Repair", exact: true }).click();
  await asked.getByLabel("Account token", { exact: true }).fill("sample-token");
  await asked.getByRole("button", { name: "Repair", exact: true }).click();

  await expect(problem).toHaveCount(0);
  await expect(sections.getByRole("link", { name: "Domain", exact: true })).toBeVisible();
});

// Drift: a status could only be retyped into a report; or the copy would hold the pieces to repair alone, a count over a problem it does not name, or who ran the check, which is a user's email.
test("Copy status copies Domain's line, the problem it counts, and every piece of the table, those in place and those to repair, as plain text that names nobody", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Domain");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  // The line names who ran the check once the screen holds the run the install then remembers: the copy says when that run was.
  await expect(domainLine(page, "3 to repair")).toContainText("Checked");
  await expect(domainLine(page, "3 to repair")).toContainText("@");
  const shown = await page.getByRole("table", { name: "Pieces", exact: true }).locator("tbody tr").evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll("td")].slice(0, 3).map((cell) => cell.textContent ?? "")));

  const copied = await ownClipboard(page);
  await page.getByRole("button", { name: "Copy status", exact: true }).click();
  await expect(said(page, "Status copied.")).toBeVisible();
  const text = (await copied()) ?? "";
  const [line, problem, ...pieces] = text.split("\n");

  expect([line, problem]).toEqual([expect.stringMatching(/^poplin \S+, under a domain\. Checked \d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z\. 3 to repair\.$/), `To repair: ${MENDED_BY_REPAIR}`]);
  expect(pieces.map((piece) => piece.split(/ {2,}/))).toEqual(shown.map(([piece, state, detail]) => [state, piece, detail]));
  expect([pieces.some((piece) => piece.startsWith("unchanged ")), pieces.some((piece) => piece.startsWith("missing ")), text.includes("@")]).toEqual([true, true, false]);
});
