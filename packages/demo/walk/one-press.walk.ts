// One press, one change: a double click on a button that sends a change, or on the button of a question, sends the change once, and the line a person reads is the line of that change.

import { expect, type Page } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, openPanel, said, siteNames, TRASH, test, trash } from "./visit";

/** The sample site that starts in the trash, by its title and by its name. */
const TRASHED = { title: "Notes from the offsite", name: "old-notes" } as const;

/** The demo's own page of a waiting login, which stands where the terminal would be: it prints the link and the code. */
const WAITING = "state/allow/waiting";

/** The changes a page sent, by the end of their path: every request that is no read. */
function changesOf(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URL(request.url()).pathname.split("/data/")[1] ?? request.url());
  });

  return sent;
}

/** Wait until the page has rested for a moment after a change, so a second request a double click sent has had the time to leave. */
async function rested(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((done) => setTimeout(done, 400)));
}

// Drift: the second press of a double click reached the delete while the first was on its way: the site went, and the question stayed open with "No site is at this address" at its field, over a panel of no site.
test("a double click on Delete for good deletes the site once, and closes the question and the panel", async ({ page }) => {
  await arrive(page);
  await page.goto(TRASH);
  await page.getByRole("row").getByRole("button", { name: `Details of ${TRASHED.title}`, exact: true }).press("Enter");
  await page.getByRole("dialog", { name: TRASHED.title, exact: true }).getByRole("button", { name: "Delete for good", exact: true }).click();
  const question = page.getByRole("alertdialog", { name: `Delete ${TRASHED.title} for good?`, exact: true });
  await question.getByRole("textbox", { name: "Site's name", exact: true }).fill(TRASHED.name);
  const sent = changesOf(page);

  await question.getByRole("button", { name: "Delete for good", exact: true }).dblclick();
  await expect(said(page, `${TRASHED.title} deleted for good.`)).toBeVisible();
  await rested(page);

  await expect(question).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent.filter((path) => path.endsWith("/delete-for-good")).length).toBe(1);
});

// Drift: the row's button took both presses: the site came back, and the line a person read was the second press's refusal, "The site is not in the trash."
test("a double click on Restore in a row of the trash restores the site once, and says so", async ({ page }) => {
  const [first = ""] = await arrive(page);
  await trash(page, first);
  await page.goto(TRASH);
  await expect(siteNames(page).first()).toBeVisible();
  const sent = changesOf(page);

  await page.getByRole("button", { name: `Restore ${first}`, exact: true }).dblclick();
  await expect(said(page, `${first} restored.`)).toBeVisible();
  await rested(page);

  await expect(said(page, `${first} restored.`)).toBeVisible();
  expect(sent.filter((path) => path.endsWith("/restore")).length).toBe(1);
});

// Drift: Approve took both presses: the login was approved, and the line said that it "is no longer waiting".
test("a double click on Approve approves the login once, and says so", async ({ page }) => {
  await page.goto(WAITING);
  const printed = page.locator("section").filter({ has: page.getByRole("link") }).first();
  await expect(printed.locator("code")).toBeVisible({ timeout: FIRST_LOAD_MS });
  const letters = ((await printed.locator("code").textContent()) ?? "").slice(-4);
  await printed.getByRole("link").click();
  const review = page.getByRole("dialog", { name: "Approve this login?", exact: true });
  await review.getByRole("textbox", { name: "Last 4 letters of the code in your terminal", exact: true }).fill(letters);
  // A login that asked for more than it gets is told so in the same line.
  const allowed = page.getByRole("region", { name: /^Notifications/ }).getByText(/^Approved.* Its token shows here in a few seconds\.$/u);
  const sent = changesOf(page);

  await review.getByRole("button", { name: "Approve", exact: true }).dblclick();
  await expect(allowed).toBeVisible();
  await rested(page);

  await expect(allowed).toBeVisible();
  expect(sent.filter((path) => path === "logins/decide").length).toBe(1);
});

// Drift: a question's button is still drawn while the question fades, and took the second press of a double click: the update was started twice, and the line said that one "was tried in this minute already".
test("a double click on the button of a question answers it once: one update is started", async ({ page }) => {
  await arrive(page);
  await page.getByRole("button", { name: "Update now", exact: true }).click();
  const sent = changesOf(page);

  await page.getByRole("alertdialog", { name: /^Update to / }).getByRole("button", { name: "Update now", exact: true }).dblclick();
  await expect(page.getByText("Updated. Reload the page.", { exact: true })).toBeVisible();
  await rested(page);

  expect(sent.length).toBe(1);
});

// Drift: the second press of a double click came before the page had drawn Save as off, and the same changes were saved twice.
test("a double click on Save in Settings saves the changes once", async ({ page }) => {
  await arrive(page);
  await page.goto("settings");
  await page.getByRole("textbox", { name: "Keep versions", exact: true }).fill("7");
  const sent = changesOf(page);

  await page.getByRole("button", { name: "Save", exact: true }).dblclick();
  await expect(page.getByRole("region", { name: /^Notifications/ }).getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await rested(page);

  expect(sent).toEqual(["settings"]);
});

/**
 * Send a dialog's form again at the moment the dialog begins to close, as a second Enter or a second click does that comes while the dialog fades: the page does it itself, the moment the library marks the dialog as closed.
 *
 * @returns once the form was sent, with whether the dialog was still drawn then
 */
function sendWhileClosing(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((done) => {
        const popup = document.querySelector('[data-slot="dialog-content"]');
        if (popup === null) return done(false);

        const watch = new MutationObserver(() => {
          if (!popup.hasAttribute("data-closed")) return;

          watch.disconnect();
          popup.querySelector("form")?.requestSubmit();
          popup.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
          done(popup.isConnected);
        });
        watch.observe(popup, { attributes: true });
      }),
  );
}

// Drift: a dialog's form and buttons are still drawn while it fades, with the focus still in it. A person's second click or Enter comes a tenth of a second after the first,
// when a quick change is done and its button is on again: the fading dialog would send the change a second time, and Duplicate would make two copies.
test("a dialog that is closing sends nothing: its form sent again while it fades makes no copy", async ({ page }) => {
  const [first = ""] = await arrive(page);
  await openPanel(page, first);
  await page.getByRole("dialog", { name: first, exact: true }).getByRole("button", { name: "Duplicate", exact: true }).click();
  const asks = page.getByRole("dialog", { name: `Duplicate ${first}?`, exact: true });
  await expect(asks.getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
  const sent = changesOf(page);
  const again = sendWhileClosing(page);

  await asks.getByRole("button", { name: "Cancel", exact: true }).click();
  const drawn = await again;
  await expect(asks).toHaveCount(0);
  await rested(page);

  expect([drawn, sent]).toEqual([true, []]);
});
