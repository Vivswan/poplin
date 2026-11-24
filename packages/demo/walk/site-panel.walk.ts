// A site's panel on the screens between a phone and the widest: it lies over the end of the list, which stays in sight and in reach beside it. And its Edit, which starts from what the site holds every time it is opened.
// And the fields that take a site's name or a user's email, which keep one that is too long and say so. And where a phone's panel breaks a long link. And its three folds, and the tree of a site's files.

import { expect, type Locator } from "@playwright/test";

import { arrive, FIRST_LOAD_MS, FOLDS, foldOf, onPage, openFold, openPanel, siteName, test, toSection } from "./visit";

/** The screens the walk is taken on: the narrowest the Sites table fits, and one between it and the widest. */
const SCREENS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const;

/** The screens the folds are walked on: a phone, where the panel takes the list's place, and one it lies over the list on. */
const FOLD_SCREENS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

/** The sample sites the walk opens and looks for, by their titles; `long` has a link too long for one line of a phone's panel. */
const SAMPLE = { opened: "Pricing", beside: "Team handbook", long: "Q3 sales report" } as const;

/** The lines a phone's panel draws the letters of that site's link on: the name and the dash after the hidden part, then the letter of who can open the site with what follows it. */
const LINES = ["sales-report---", "p-poplin"];

/** The sample site that holds two other samples beside its own, each under a folder: its folders, and the page one of them holds, by the title of that page. */
const NESTED = { title: "Team site", folders: ["assets/", "deck/", "report/"], folder: "deck/", page: "index.html", shows: "Glowpod 2 launch plan: Driftwick Outdoor" } as const;

/** What is typed into the Edit of a site and then left. */
const DRAFT = { title: "Draft X", name: "ab" } as const;

/** A name ten characters longer than a site's name may be. */
const TOO_LONG = "long-name-".repeat(5);

/** An email of more characters than an address may have. */
const LONG_EMAIL = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.example.com`;

/** The dialogs of a site's panel that take a name: the button of the panel that opens each, what it is called, its field, and the button that sends it. */
const NAMED = [
  { opens: "Edit", dialog: "Edit the site", field: "Name", sends: "Save" },
  { opens: "Duplicate", dialog: `Duplicate ${SAMPLE.opened}?`, field: "Name", sends: "Duplicate" },
  { opens: "Public", dialog: `Make ${SAMPLE.opened} public?`, field: "Public name", sends: "Make it public" },
] as const;

/** Whether each fold of a panel is open, as its heading says it, in the order of the screen. */
function folds(panel: Locator): Promise<(string | null)[]> {
  return Promise.all(FOLDS.map((name) => foldOf(panel, name).getAttribute("aria-expanded")));
}

/** Make another version of the panel's site live, and wait until the panel shows it live: the button that was pressed leaves then. */
async function makeLive(panel: Locator): Promise<void> {
  const button = panel.getByRole("button", { name: /^Make live: version \d+$/u }).first();
  const pressed = (await button.getAttribute("aria-label")) ?? "";
  await button.click();

  await expect(panel.getByRole("button", { name: pressed, exact: true })).toHaveCount(0);
}

for (const size of SCREENS) {
  test.describe(`on a screen ${size.width} px wide, under a site's panel`, () => {
    test.use({ viewport: size });

    // Drift: the panel would take the whole room of the list again on a screen narrower than the widest, where no row is seen or pressed while it is open.
    test("the panel is 440 px wide at the end of the screen, the table keeps its width, a site's title stays in sight beside it, and a press under the last row closes it", async ({ page }) => {
      await arrive(page);
      const list = onPage(page, "region", { name: "Sites", exact: true });
      const table = onPage(page, "table", { name: "Sites", exact: true });
      const without = await table.boundingBox();

      await openPanel(page, SAMPLE.opened);
      await expect(page.getByRole("dialog", { name: SAMPLE.opened, exact: true })).toBeVisible();
      // The panel's place, hairline included.
      const over = await page.getByRole("complementary", { name: SAMPLE.opened, exact: true }).boundingBox();
      expect(over === null ? undefined : { width: over.width, end: over.x + over.width }).toEqual({ width: 440, end: size.width });
      expect(await table.boundingBox()).toEqual(without);
      const title = await siteName(page, SAMPLE.beside).boundingBox();
      expect((title?.x ?? Number.NaN) + (title?.width ?? Number.NaN)).toBeLessThanOrEqual(over?.x ?? 0);

      const room = await list.boundingBox();
      await page.mouse.click((room?.x ?? 0) + 120, (room?.y ?? 0) + (room?.height ?? 0) - 20);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Details of ${SAMPLE.opened}`, exact: true })).toBeFocused();
    });
  });
}

// Drift: the Edit of a site is kept while it is closed, so what was typed and left would be there at the next opening, with Save lit over a change nobody means.
for (const leave of ["Cancel", "Escape"] as const) {
  test(`an Edit that was left by ${leave} starts from what the site holds when it is opened again`, async ({ page }) => {
    await arrive(page);
    await openPanel(page, SAMPLE.opened);
    const edit = page.getByRole("dialog", { name: "Edit the site", exact: true });
    const [title, name] = [edit.getByRole("textbox", { name: "Title", exact: true }), edit.getByRole("textbox", { name: "Name", exact: true })];
    const open = page.getByRole("dialog", { name: SAMPLE.opened, exact: true }).getByRole("button", { name: "Edit", exact: true });
    await open.click();
    const held = [await title.inputValue(), await name.inputValue()];
    await title.fill(DRAFT.title);
    await name.fill(DRAFT.name);
    await expect(edit.getByRole("button", { name: "Save", exact: true })).toBeEnabled();

    await (leave === "Cancel" ? edit.getByRole("button", { name: "Cancel", exact: true }).click() : page.keyboard.press("Escape"));
    await expect(edit).toHaveCount(0);
    await open.click();

    expect([await title.inputValue(), await name.inputValue()]).toEqual(held);
    await expect(edit.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  });
}

for (const { opens, dialog, field, sends } of NAMED) {
  // Drift: a field that takes no more than 40 characters cuts a longer name with no word, and what is left is saved as if it were what was typed.
  test(`a name of ${TOO_LONG.length} characters typed after ${opens} is kept whole in "${field}" and refused there`, async ({ page }) => {
    await arrive(page);
    await openPanel(page, SAMPLE.opened);
    await page.getByRole("dialog", { name: SAMPLE.opened, exact: true }).getByRole("button", { name: opens, exact: true }).click();
    const asks = page.getByRole("dialog", { name: dialog, exact: true });
    const name = asks.getByRole("textbox", { name: field, exact: true });
    // Typed key by key: only keys are held back by a field's own limit.
    await name.clear();
    await name.pressSequentially(TOO_LONG);
    await asks.getByRole("button", { name: sends, exact: true }).click();

    await expect(asks.getByText(/^The name breaks the rules/)).toBeVisible();
    await expect(name).toHaveValue(TOO_LONG);
  });
}

test.describe("on a phone, in a site's panel", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Drift: a browser goes on in the next line after any dash between letters, so the link would break after "-p-" again and leave the last word of the address alone under it.
  test("a link too long for one line goes on in the next after a dash, with the letter of who can open the site and what follows it whole", async ({ page, browserName }) => {
    await arrive(page);
    await openPanel(page, SAMPLE.long);
    const link = page.getByRole("dialog", { name: SAMPLE.long, exact: true }).getByTitle(/^Part of the link is hidden here/);
    await expect(link).toBeVisible();
    // The first page of a Firefox that has just started is at times drawn with a proportional face in place of every monospace one, and the link fits one line in it. Loading the page again brings the monospace face.
    // The address holds the open panel, so the page comes back with it.
    if (browserName === "firefox") {
      await page.reload();
      await expect(link).toBeVisible();
    }

    // The link's letters by the line each is drawn on; the dots of the hidden part are no letters.
    const lines = (): Promise<string[]> =>
      link.evaluate((drawn) => {
        const byTop = new Map<number, string>();
        const texts = document.createTreeWalker(drawn, NodeFilter.SHOW_TEXT);
        for (let text = texts.nextNode(); text !== null; text = texts.nextNode()) {
          for (const [at, letter] of [...(text.textContent ?? "")].entries()) {
            const one = document.createRange();
            one.setStart(text, at);
            one.setEnd(text, at + 1);
            const top = Math.round(one.getBoundingClientRect().top);
            byTop.set(top, `${byTop.get(top) ?? ""}${letter}`);
          }
        }

        return [...byTop].sort(([one], [other]) => one - other).map(([, line]) => line);
      });

    // The panel slides in and its font arrives: the lines are read until they hold.
    await expect.poll(lines).toEqual(LINES);
  });
});

for (const size of FOLD_SCREENS) {
  test.describe(`on a screen ${size.width} px wide, at the folds of a site's panel`, () => {
    test.use({ viewport: size });

    // Drift: the files, the versions, and the facts would stand open again over a panel as long as it was; Tab would reach the folds in another order than the screen has them in;
    // a fold would close over a change made in it; or one a person opened would be folded again in the next site's panel, and after the page is loaded again.
    test("the folds start folded and follow who can open the site in the order of the keys; they stay open over Make live, and as they were left in the next site's panel and after the page is loaded again", async ({ page }) => {
      await arrive(page);
      await openPanel(page, NESTED.title);
      const first = page.getByRole("dialog", { name: NESTED.title, exact: true });
      await expect(foldOf(first, "Details")).toBeVisible();
      expect(await folds(first)).toEqual(["false", "false", "false"]);

      await first.getByRole("button", { name: "Public", exact: true }).focus();
      for (const name of FOLDS) {
        await page.keyboard.press("Tab");
        await expect(foldOf(first, name)).toBeFocused();
      }
      await page.keyboard.press("Enter");
      await expect(first.getByRole("switch", { name: "Allow embedding", exact: true })).toBeVisible();
      for (const name of ["Files", "Versions"] as const) await foldOf(first, name).press("Enter");

      // Another version live is another tree of files: Files stays open over it, as Versions does over the button that was pressed.
      await makeLive(first);
      await expect(first.getByRole("tree", { name: "Files", exact: true })).toBeVisible();
      expect(await folds(first)).toEqual(["true", "true", "true"]);

      await foldOf(first, "Versions").press("Enter");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openPanel(page, SAMPLE.opened);
      const next = page.getByRole("dialog", { name: SAMPLE.opened, exact: true });
      await expect(next.getByRole("tree", { name: "Files", exact: true })).toBeVisible();
      expect(await folds(next)).toEqual(["true", "false", "true"]);

      // The address holds the open panel, so the page comes back with it.
      await page.reload();
      await expect(next.getByRole("tree", { name: "Files", exact: true })).toBeVisible({ timeout: FIRST_LOAD_MS });
      await expect(next.getByRole("switch", { name: "Allow embedding", exact: true })).toBeVisible();
      expect(await folds(next)).toEqual(["true", "false", "true"]);
    });
  });
}

// Drift: a fold that another tab folded away would take with it the question that is open in it and the control that holds the focus, which Firefox and WebKit then leave on the page itself, outside the panel;
// or Files would be drawn anew with another live version's tree, as the other tab left it.
test("a fold that is drawn stays as it is when another tab folds it away, with the focus in it and over Make live; the next panel that is drawn has it folded", async ({ page, context }) => {
  await arrive(page);
  await openPanel(page, NESTED.title);
  const panel = page.getByRole("dialog", { name: NESTED.title, exact: true });
  const embedding = panel.getByRole("switch", { name: "Allow embedding", exact: true });
  for (const name of FOLDS) await openFold(panel, name);
  await embedding.focus();

  const other = await context.newPage();
  await arrive(other);
  await openPanel(other, NESTED.title);
  const there = other.getByRole("dialog", { name: NESTED.title, exact: true });
  for (const name of ["Files", "Details"] as const) {
    await foldOf(there, name).click();
    await expect(foldOf(there, name)).toHaveAttribute("aria-expanded", "false");
  }

  await page.bringToFront();
  await expect(embedding).toBeFocused();
  await makeLive(panel);
  await expect(panel.getByRole("tree", { name: "Files", exact: true })).toBeVisible();
  expect(await folds(panel)).toEqual(["true", "true", "true"]);

  await page.keyboard.press("Escape");
  await openPanel(page, SAMPLE.opened);
  const next = page.getByRole("dialog", { name: SAMPLE.opened, exact: true });
  await expect(foldOf(next, "Versions")).toHaveAttribute("aria-expanded", "true");
  expect(await folds(next)).toEqual(["false", "true", "false"]);
});

// Drift: the panel would say how many files a site holds and name none of them; or a folder would open on nothing, or a file's row lead to another file than the one it names.
test("Files in a site's panel opens as a tree with the folders first, a folder opens on what it holds, and a file in it opens that file of the site in a new tab", async ({ page }) => {
  await arrive(page);
  await openPanel(page, NESTED.title);
  const panel = page.getByRole("dialog", { name: NESTED.title, exact: true });
  const tree = panel.getByRole("tree", { name: "Files", exact: true });
  await expect(tree).toHaveCount(0);

  await openFold(panel, "Files");
  const top = tree.locator("[role='treeitem'][aria-level='1']");
  await expect(top.first()).toBeVisible();
  // A folder's row is pressed, so it shows the hand, as every other control does.
  await expect(top.first().locator("[data-slot='tree-label']")).toHaveCSS("cursor", "pointer");
  // The folders stand before the files, and none is open: only what is at the top is shown.
  // Each row is read by the walk's own scripts alone. The panel takes its name from its title's id, and the Firefox that Playwright 1.65 ships (159, build 1572)
  // ends a page where such a name is read once by the walk's scripts and once among the page's, as `evaluateAll` reads it.
  const rows = await Promise.all(NESTED.folders.map((_folder, at) => top.nth(at).textContent()));
  expect([rows, await tree.getByRole("treeitem", { expanded: true }).count()]).toEqual([[...NESTED.folders], 0]);

  await tree.getByRole("treeitem", { name: NESTED.folder, exact: true }).click();
  const file = tree.getByRole("treeitem", { name: NESTED.folder, exact: true }).getByRole("link", { name: NESTED.page });
  await expect(file).toBeVisible();
  const [opened] = await Promise.all([page.waitForEvent("popup"), file.click()]);

  await expect(opened).toHaveTitle(NESTED.shows);
  expect(new URL(opened.url()).pathname.endsWith(`/${NESTED.folder}${NESTED.page}`)).toBe(true);
});

// Drift: the field of Add a user took 254 characters, so a longer email lost its end with no word and what was left was added as a user.
test(`an email of ${LONG_EMAIL.length} characters typed in Add a user is kept whole and refused there`, async ({ page }) => {
  await arrive(page);
  await toSection(page, "Access");
  await page.getByRole("button", { name: "Add a user", exact: true }).click();
  const adds = page.getByRole("dialog", { name: "Add a user", exact: true });
  const email = adds.getByRole("textbox", { name: "Email", exact: true });
  await email.pressSequentially(LONG_EMAIL);
  await adds.getByRole("button", { name: "Add a user", exact: true }).click();

  await expect(adds.getByText(/^Type an email address/)).toBeVisible();
  await expect(email).toHaveValue(LONG_EMAIL);
});
