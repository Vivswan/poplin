// The link walk: every place the dashboard's own controls lead to, on a wide screen and on a phone, in the light scheme and in the dark one. A question is opened and left. One token is removed near the end, and the last stop starts the sample data over.

import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, openPanel, reset, said, screenHeading, siteName, TRASH, test } from "./visit";

/** The screens the walk is taken on. A wide one shows tables and the side navigation; a narrow one shows lists, and the sections behind a button. */
const VIEWPORTS = [
  { width: 1440, height: 900, wide: true },
  { width: 390, height: 844, wide: false },
] as const;

/** The narrowest screen the Sites table fits with no panel open. */
const FITS_FROM = { width: 1024, height: 768 };

/** The narrow one of them alone: a phone. */
const PHONE = { width: VIEWPORTS[1].width, height: VIEWPORTS[1].height };

/** Two small phones: one lying on its side, too short for the sections' sheet to show all it holds at once, and one upright, where the sheet fits. */
const SMALL_PHONES = [
  { width: 667, height: 390 },
  { width: 390, height: 667 },
] as const;

/** The schemes a browser asks for. The dashboard follows the browser while its System theme is chosen, which is where it starts. */
const SCHEMES = ["light", "dark"] as const;

/** What the sample data holds that the walk opens: an unlisted site by its title, a site by its title for the graph, a person who is not the visitor, a token, and a login that waits. */
const SAMPLE = { site: "Pricing", graphed: "Team handbook", person: "jonas@example.com", token: "design-laptop", login: "build-server" } as const;

/** The sample site that is in the trash: what the list calls it, which is its title, and its name, which its link holds. */
const TRASHED = { title: "Notes from the offsite", name: "old-notes" } as const;

/** How a moment is written: the day with two figures, and the time to the minute. */
const MOMENT = String.raw`\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}`;

/** The key the browser keeps the choice of the graph under: its days, and its sites by the titles they were picked with. */
const VISITS_CHOICE_KEY = "poplin.usage.visits";

/** A site's title too long for two names of the graph's lines to share a row of a phone. */
const LONG_TITLE = "Field notes of the northern team, part";

/** Where the notes of a newer version are read: the page of the project's releases. */
const RELEASES = "https://github.com/Vivswan/poplin/releases";

/** An email typed into the dialog that adds a user: no user of the sample data has it. */
const TYPED_EMAIL = "walk@example.com";

/** A user the walk adds and then removes. */
const ADDED_EMAIL = "walk-user@example.com";

/** What the Domain screen says at its top once a user was added or removed, until a repair. */
const USERS_CHANGED = "Users changed. Press Repair.";

/** The name of the button that opens the sections on a narrow screen: it says how many problems the sections hold, where they hold any. */
const SECTIONS_BUTTON = /^Sections(, \d+ problems?)?$/;

/** The kinds of file whose refusal breaks a screen. */
const NEEDED_KINDS = ["document", "script", "stylesheet", "font"];

/** The path every read and change of the dashboard's data goes to. */
const DATA_PATH = "/data/";

/** Two times of the same length whose figures differ: the ones of the first are narrow shapes, the ones of the second wide. */
const TIMES = ["11 Nov 2026, 11:11", "08 Nov 2026, 06:59"] as const;

/** The face the dashboard carries for its figures, as its stylesheet names it: the first face of every text. */
const FIGURES = '"Even Figures"';

/** The dashboard's own face alone, whose figures are each as wide as their shape: what the times are measured in as the control. */
const OWN_FACE = '"Libre Franklin Variable"';

/** The mark of a filled button among the classes the UI library draws it with. */
const FILLED = /(^| )bg-primary( |$)/;

/** Every place of the walk, in the order it is taken: each starts where the one before it ended. */
const STOPS: readonly Stop[] = [
  {
    name: "Sites, from the side",
    screen: "Sites",
    open: (page) => toSection(page, "Sites"),
    shows: (page) => [screenHeading(page, "Sites"), siteName(page, SAMPLE.site)],
  },
  {
    name: "the notes of the newer version, at the side",
    only: "wide",
    open: async () => {},
    shows: (page) => [page.locator(`a[href="${RELEASES}"][target="_blank"][rel="noreferrer"]`, { hasText: "What changed" })],
  },
  {
    name: "Access, from the side",
    screen: "Access",
    open: (page) => toSection(page, "Access"),
    shows: (page, wide) => [screenHeading(page, "Access"), page.getByRole("tab", { name: "Users", selected: true }), rows(page, wide, "Users")],
  },
  {
    name: "Tokens, the second tab of Access",
    open: (page) => page.getByRole("tab", { name: "Tokens", exact: true }).click(),
    shows: (page, wide) => [screenHeading(page, "Access"), page.getByRole("tab", { name: "Tokens", selected: true }), rows(page, wide, "Tokens")],
  },
  {
    name: "Activity, from the side",
    screen: "Activity",
    open: (page) => toSection(page, "Activity"),
    shows: (page, wide) => [screenHeading(page, "Activity"), rows(page, wide, "Activity")],
  },
  {
    name: "the total, at the foot of Activity",
    open: async () => {},
    shows: (page) => [page.getByRole("navigation", { name: "Pages", exact: true }).filter({ visible: true }).getByText(/^1 to 50 of [\d,]+$/)],
  },
  {
    name: "the log saved as a file, from Download",
    open: saveLog,
    shows: (page) => [said(page, "Download started.")],
  },
  {
    name: "Usage, from the side",
    screen: "Usage",
    open: (page) => toSection(page, "Usage"),
    shows: (page, wide) => [screenHeading(page, "Usage"), rows(page, wide, "Usage"), page.getByRole("heading", { name: "Visits", exact: true }), page.locator("path[data-line=all]")],
  },
  {
    name: "a site picked beside all sites, on the graph of visits",
    open: (page) => tickSite(page),
    shows: (page) => [page.getByRole("list", { name: "Lines", exact: true }).getByText(SAMPLE.graphed, { exact: true }), page.locator("path[data-line]").nth(1)],
    close: (page) => tickSite(page),
  },
  {
    name: "Settings, from the side",
    screen: "Settings",
    open: (page) => toSection(page, "Settings"),
    shows: (page) => [
      screenHeading(page, "Settings"),
      page.getByRole("heading", { name: "New sites", exact: true }),
      page.getByRole("switch", { name: "Show in search engines", exact: true }),
      page.getByRole("textbox", { name: "All sites together", exact: true }),
      page.getByRole("switch", { name: "Check for new versions", exact: true }),
    ],
  },
  {
    name: "Domain, from the side",
    screen: "Domain",
    open: (page) => toSection(page, "Domain"),
    shows: (page) => [screenHeading(page, "Domain"), domainLine(page, "Nothing to repair")],
  },
  {
    name: "the token a repair asks for",
    open: (page) => page.getByRole("button", { name: "Repair", exact: true }).click(),
    shows: (page) => [
      page.getByRole("dialog", { name: "Repair the domain", exact: true }).getByRole("button", { name: "Open the account token form", exact: true }),
      page.getByRole("dialog", { name: "Repair the domain", exact: true }).getByLabel("Account token", { exact: true }),
    ],
    close: (page) => page.getByRole("dialog", { name: "Repair the domain", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click(),
  },
  {
    name: "the trash, from the filter of Sites",
    open: async (page) => {
      await toSection(page, "Sites");
      await narrowSites(page, "Trash");
    },
    shows: (page) => [page.getByRole("button", { name: /^Restore /u }).first()],
    close: (page) => narrowSites(page, "All sites"),
  },
  {
    name: "how a new site is made",
    open: (page) => page.getByRole("button", { name: "New site", exact: true }).click(),
    shows: (page) => [page.getByText("Publish a folder", { exact: true })],
    close: pressEscape,
  },
  {
    name: "the menu of the table's columns",
    only: "wide",
    open: (page) => page.getByRole("button", { name: "Columns", exact: true }).click(),
    shows: (page) => [page.getByRole("menuitem", { name: "Reset the layout", exact: true })],
    close: pressEscape,
  },
  {
    name: "a site's panel",
    open: (page) => openPanel(page, SAMPLE.site),
    shows: (page) => [
      panel(page).getByRole("heading", { name: SAMPLE.site, exact: true }),
      panel(page).getByRole("heading", { name: "Versions", exact: true }),
    ],
  },
  {
    name: "the title and the name, from the panel",
    open: (page) => panel(page).getByRole("button", { name: "Edit", exact: true }).click(),
    shows: (page) => [editDialog(page).getByRole("textbox", { name: "Title", exact: true }), editDialog(page).getByRole("textbox", { name: "Name", exact: true })],
    close: cancelDialog,
  },
  {
    // Drift: the press leaves the focus on the page, and the Escape after it would close the panel under the question too.
    name: "New link, from the panel, left by Escape after a press on the dimmed page",
    open: (page) => panel(page).getByRole("button", { name: "New link", exact: true }).click(),
    shows: (page) => [question(page, "Make a new link?")],
    close: async (page) => {
      await page.mouse.click(5, 5);
      await pressEscape(page);
      await expect(panel(page).getByRole("heading", { name: SAMPLE.site, exact: true })).toBeVisible();
    },
  },
  {
    name: "the question before a site is opened wider",
    open: (page) => panel(page).getByRole("button", { name: "Public", exact: true }).click(),
    shows: (page) => [asksPublicName(page).getByRole("textbox", { name: "Public name", exact: true })],
    close: (page) => asksPublicName(page).getByRole("button", { name: "Cancel", exact: true }).click(),
  },
  {
    name: "the way back from the panel to the sites",
    open: (page) =>
      panel(page)
        .getByRole("button", { name: /^Close/ })
        .click(),
    shows: (page) => [screenHeading(page, "Sites"), siteName(page, SAMPLE.site)],
  },
  {
    name: "the question before an update, from the side",
    only: "wide",
    open: (page) => page.getByRole("button", { name: "Update now", exact: true }).click(),
    shows: (page) => [question(page, /^Update to /)],
    close: leaveBy("Cancel"),
  },
  {
    name: "the notes of the newer version in the sections of a phone, and from there the question before an update",
    only: "narrow",
    open: async (page) => {
      await page.getByRole("button", { name: SECTIONS_BUTTON }).click();
      const sections = page.getByRole("dialog");
      await expect(sections.locator(`a[href="${RELEASES}"][target="_blank"][rel="noreferrer"]`, { hasText: "What changed" })).toBeVisible();
      await sections.getByRole("button", { name: "Update now", exact: true }).click();
    },
    shows: (page) => [question(page, /^Update to /)],
    close: leaveBy("Cancel"),
  },
  {
    name: "the dialog that adds a user, with an email typed",
    open: async (page) => {
      await toSection(page, "Access");
      await page.getByRole("button", { name: "Add a user", exact: true }).click();
      await addPerson(page).getByRole("textbox", { name: "Email", exact: true }).fill(TYPED_EMAIL);
    },
    shows: (page) => [addPerson(page).getByRole("button", { name: "Add a user", exact: true, disabled: false })],
    close: (page) => addPerson(page).getByRole("button", { name: "Cancel", exact: true }).click(),
  },
  {
    name: "the question before everyone is signed out, from the users",
    open: (page) => page.getByRole("button", { name: "Sign everyone out", exact: true }).click(),
    shows: (page) => [question(page, "Sign everyone out?")],
    close: leaveBy("Cancel"),
  },
  {
    name: "the question before a user is removed",
    open: (page) => fromRowMenu(page, SAMPLE.person, "Remove"),
    shows: (page) => [question(page, `Remove ${SAMPLE.person}?`)],
    close: leaveBy("Cancel"),
  },
  {
    name: "a user added, after which a repair waits",
    open: async (page) => {
      await page.getByRole("button", { name: "Add a user", exact: true }).click();
      await addPerson(page).getByRole("textbox", { name: "Email", exact: true }).fill(ADDED_EMAIL);
      await addPerson(page).getByRole("button", { name: "Add a user", exact: true }).click();
    },
    shows: (page) => [said(page, "Added. Next, open Domain and press Repair.")],
  },
  {
    name: "Domain, which says the users changed",
    open: (page) => toSection(page, "Domain"),
    shows: (page) => [domainLine(page, USERS_CHANGED)],
  },
  {
    name: "a repair, after which no user waits",
    open: repair,
    shows: (page) => [domainLine(page, /repaired|Nothing to repair/)],
  },
  {
    name: "that user removed, after which a repair waits again",
    open: async (page) => {
      await toSection(page, "Access");
      await fromRowMenu(page, ADDED_EMAIL, "Remove");
      await leaveBy("Remove")(page);
    },
    shows: (page) => [said(page, "Removed. Next, open Domain and press Repair.")],
  },
  {
    name: "Domain, which says the users changed once more",
    open: (page) => toSection(page, "Domain"),
    shows: (page) => [domainLine(page, USERS_CHANGED)],
  },
  {
    name: "a second repair, after which nothing is left",
    open: repair,
    shows: (page) => [domainLine(page, "Nothing to repair")],
    close: (page) => toSection(page, "Access"),
  },
  {
    name: "how a token is added, from the tokens",
    open: async (page) => {
      await page.getByRole("tab", { name: "Tokens", exact: true }).click();
      await page.getByRole("button", { name: "Add a token", exact: true }).click();
    },
    shows: (page) => [page.getByRole("dialog", { name: "Add a token", exact: true }).getByRole("button", { name: "Copy the command", exact: true })],
    close: pressEscape,
  },
  {
    name: "the question before a token is removed",
    open: (page) => fromRowMenu(page, SAMPLE.token, "Remove"),
    shows: (page) => [question(page, `Remove ${SAMPLE.token}?`)],
    close: leaveBy("Cancel"),
  },
  {
    name: "a removed token, which then stands under Removed tokens",
    open: async (page, wide) => {
      await fromRowMenu(page, SAMPLE.token, "Remove");
      await leaveBy("Remove")(page);
      // The token's row leaves the list a moment later and moves everything under it up by more than a button's height: a press sent before that lands beside the button.
      await expect(rows(page, wide, "Tokens").getByText(SAMPLE.token, { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: /^Removed tokens/ }).click();
    },
    shows: (page, wide) => [rows(page, wide, "Removed tokens").getByText(SAMPLE.token, { exact: true })],
  },
  {
    name: "the review of a waiting login, which names it in quotes and starts at the least it may change",
    open: (page, wide) => reviewOf(page, wide, SAMPLE.login).click(),
    shows: (page) => [
      review(page).getByText("Allow it only if you started this login yourself.", { exact: true }),
      review(page).getByText(`"${SAMPLE.login}"`, { exact: true }),
      review(page).getByRole("button", { name: "Own sites only", exact: true, pressed: true }),
      review(page).getByRole("button", { name: "Allow", exact: true, disabled: true }),
    ],
    close: (page) => review(page).getByRole("button", { name: "Close", exact: true }).click(),
  },
  {
    name: "the review the printed link opens, which holds no letter to type and allows the login once the terminal's are typed",
    open: async (page) => {
      // The demo's own page stands where the terminal would be: it prints the link and the code.
      await page.goto("state/allow/waiting");
      const printed = page.locator("section").filter({ hasText: SAMPLE.login });
      const letters = ((await printed.locator("code").textContent()) ?? "").slice(-4);
      await printed.getByRole("link").click();
      await expect(review(page).getByRole("button", { name: "Allow", exact: true, disabled: true })).toBeVisible();
      expect([letters.length, page.url().includes(letters), (await review(page).innerHTML()).includes(letters)]).toEqual([4, false, false]);
      await review(page).getByRole("textbox", { name: "Last 4 letters of the code in your terminal", exact: true }).fill(letters);
    },
    shows: (page) => [review(page).getByText(/^Anyone can start a login and send its link\./), review(page).getByRole("button", { name: "Allow", exact: true, disabled: false })],
    close: (page) => review(page).getByRole("button", { name: "Allow", exact: true }).click(),
  },
  {
    name: "a reset of the sample data, which keeps the screen it was pressed on",
    open: reset,
    shows: (page) => [said(page, "Sample data reset."), screenHeading(page, "Access")],
  },
];

/** One place of the walk. */
interface Stop {
  /** What is opened, in the words a failure is reported under. */
  readonly name: string;

  /** The screen the stop opens from the side, by its name there; left out for a place inside a screen. */
  readonly screen?: string;

  /** The one width the stop exists at; left out, it exists at both. */
  readonly only?: "wide" | "narrow";

  /** Leads there from where the stop before it ended. */
  readonly open: (page: Page, wide: boolean) => Promise<void>;

  /** What is on the screen once the place is reached. */
  readonly shows: (page: Page, wide: boolean) => readonly Locator[];

  /** Leaves the place without changing anything; what it showed is then gone. Left out, the place stays open for the next stop. */
  readonly close?: (page: Page) => Promise<void>;
}

/** Save the Activity log as comma-separated values, and read the file's first line: the headings of its fields. */
async function saveLog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Download", exact: true }).filter({ visible: true }).click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "CSV", exact: true }).click()]);
  const [first] = (await readFile(await file.path(), "utf8")).split("\r\n");

  expect([file.suggestedFilename(), first]).toEqual([expect.stringMatching(/^poplin-activity-\d{4}-\d{2}-\d{2}\.csv$/), "When (UTC),Who,What,Site,Title,Action"]);
}

/** Go to a section by its entry at the side, which a narrow screen keeps behind a button. A section whose screen holds a problem says how many after its name. */
async function toSection(page: Page, label: string): Promise<void> {
  const behind = page.getByRole("button", { name: SECTIONS_BUTTON });
  if (await behind.isVisible()) await behind.click();

  await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: new RegExp(`^${label}( \\d+ problems?)?$`) }).click();
}

/** The stops that open a screen from the side, each with the screen's name. */
function screens(): readonly (Stop & { readonly screen: string })[] {
  return STOPS.flatMap((stop) => (stop.screen === undefined ? [] : [{ ...stop, screen: stop.screen }]));
}

/** Open a screen of a wide page from the side, and wait for what it shows: what a screen draws while it is read is not the screen yet. */
async function toScreen(page: Page, stop: Stop): Promise<void> {
  await stop.open(page, true);
  for (const shown of stop.shows(page, true)) await expect(shown).toBeVisible();
}

/** The rows of a screen: a table on a wide screen, a list on a narrow one, under the same name. */
function rows(page: Page, wide: boolean, name: string): Locator {
  return page.getByRole(wide ? "table" : "list", { name, exact: true });
}

/** Check that the Sites table is as wide as its room, and that the heading and the values of its last column end where the last tool over the table ends, with no value cut. */
async function sitesFit(page: Page): Promise<void> {
  const tool = page.getByRole("button", { name: "New site", exact: true });
  // The table is measured again once the page's fonts are in, so its widths are read until they have come to rest.
  await expect(async () => {
    const box = await tool.boundingBox();
    const toolEnd = Math.round((box?.x ?? Number.NaN) + (box?.width ?? Number.NaN));
    const widths = await page.getByRole("table", { name: "Sites", exact: true }).evaluate((table) => {
      const endOf = (part: Element | null | undefined): number =>
        part === null || part === undefined ? Number.NaN : Math.round(part.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(part).paddingRight));
      const values = [...table.querySelectorAll("tbody tr > td:last-child")];

      return {
        table: table.scrollWidth,
        room: table.closest('[data-slot="scroll-area"]')?.clientWidth,
        headEnd: endOf([...table.querySelectorAll("thead th[data-column]")].at(-1)?.firstElementChild),
        valueEnd: endOf(values[0]),
        cut: values.filter((value) => (value.firstElementChild?.scrollWidth ?? 0) > (value.firstElementChild?.clientWidth ?? 0)).length,
      };
    });

    expect(widths).toEqual({ table: widths.room, room: widths.room, headEnd: toolEnd, valueEnd: toolEnd, cut: 0 });
  }).toPass();
}

/** The lines that say a result, each as the whole box it is drawn in. */
function lines(page: Page): Locator {
  return page.getByRole("region", { name: /^Notifications/ }).getByRole("listitem");
}

/** Choose what the Sites screen is narrowed to. */
async function narrowSites(page: Page, filter: string): Promise<void> {
  await page.getByRole("combobox", { name: "Which sites", exact: true }).click();
  await page.getByRole("option", { name: filter, exact: true }).click();
}

/** The review of a waiting login, under the title every review has. */
function review(page: Page): Locator {
  return page.getByRole("dialog", { name: "Allow this login?", exact: true });
}

/** The button that opens the review of the waiting login that gave itself a name: its row says the name, the button does not. */
function reviewOf(page: Page, wide: boolean, name: string): Locator {
  return rows(page, wide, "Tokens")
    .getByRole(wide ? "row" : "listitem")
    .filter({ hasText: name })
    .getByRole("button", { name: "Review", exact: true });
}

/** Press one entry of the menu at the end of a row, which is named after what the row holds. */
async function fromRowMenu(page: Page, row: string, entry: string): Promise<void> {
  await page.getByRole("button", { name: `More for ${row}`, exact: true }).click();
  await page.getByRole("menuitem", { name: entry, exact: true }).click();
}

/** The line at the top of the Domain screen, by what it says. */
function domainLine(page: Page, says: string | RegExp): Locator {
  return page.getByRole("status").filter({ hasText: says });
}

/** Repair the sample domain from the Domain screen, with a token its sample provider takes. */
async function repair(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Repair the domain", exact: true });
  await page.getByRole("button", { name: "Repair", exact: true }).click();
  await dialog.getByLabel("Account token", { exact: true }).fill("sample-token");
  await dialog.getByRole("button", { name: "Repair", exact: true }).click();
}

/** The dialog that adds a person. */
function addPerson(page: Page): Locator {
  return page.getByRole("dialog", { name: "Add a user", exact: true });
}

/** Tick or untick the graphed sample site in the list that picks the sites of the graph, and close the list. */
async function tickSite(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: "Compare sites", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(`^${SAMPLE.graphed}`) }).click();
  await page.keyboard.press("Escape");
}

/** Tick every site in the list that picks the sites of the graph, and close the list. */
async function pickEverySite(page: Page): Promise<void> {
  await page.getByRole("combobox", { name: "Compare sites", exact: true }).click();
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page.keyboard.press("Escape");
}

/** Of the names of the graph's lines: how many there are, how many show whole at once in their room, and on how many rows those stand. */
async function wholeNames(names: Locator): Promise<{ readonly all: number; readonly whole: number; readonly rows: number }> {
  return names.evaluate((list) => {
    const room = (list.closest("[data-slot='scroll-area']") ?? list).getBoundingClientRect();
    const whole = [...list.children].map((name) => name.getBoundingClientRect()).filter((name) => name.top >= room.top - 1 && name.bottom <= room.bottom + 1);

    return { all: list.children.length, whole: whole.length, rows: new Set(whole.map((name) => Math.round(name.top))).size };
  });
}

/** The panel of the sample site: over the end of the table on a wide screen, in the list's place on a narrow one. */
function panel(page: Page): Locator {
  return page.getByRole("dialog", { name: SAMPLE.site, exact: true });
}

/** A question that asks before a change. */
function question(page: Page, title: string | RegExp): Locator {
  return page.getByRole("alertdialog", { name: title, exact: true });
}

/** The question before the sample site is made public: it asks for the public name in a field. */
function asksPublicName(page: Page): Locator {
  return page.getByRole("dialog", { name: `Make ${SAMPLE.site} public?`, exact: true });
}

/** Leave a question by one of its buttons. */
function leaveBy(label: string): (page: Page) => Promise<void> {
  return (page) => page.getByRole("alertdialog").getByRole("button", { name: label, exact: true }).click();
}

/** The dialog that changes a site's title and name. */
function editDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Edit the site", exact: true });
}

/** Leave the dialog of a site's title and name by its Cancel. */
async function cancelDialog(page: Page): Promise<void> {
  await editDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
}

/** Leave a menu or a popover with Escape. */
async function pressEscape(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
}

/**
 * Watch one page for everything a screen may not do.
 *
 * @returns the list each problem is added to as it happens: an error on the console, a thrown error, something the page's policy blocked, a request to another origin, and a refused file or data call
 */
async function watchClosely(page: Page, origin: string): Promise<string[]> {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`thrown: ${String(error)}`));
  page.on("request", (request) => {
    if (!request.url().startsWith(`${origin}/`)) problems.push(`asked elsewhere: ${request.url()}`);
  });
  page.on("response", (response) => {
    const needed = NEEDED_KINDS.includes(response.request().resourceType()) || new URL(response.url()).pathname.includes(DATA_PATH);
    if (needed && response.status() >= 400) problems.push(`refused: ${response.status()} ${response.url()}`);
  });
  await page.exposeFunction("reportBlocked", (line: string) => problems.push(`blocked by the policy: ${line}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { reportBlocked: (line: string) => void }).reportBlocked(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });

  return problems;
}

for (const { width, height, wide } of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    test.describe(`at ${width}x${height}, in the ${scheme} scheme`, () => {
      test.use({ viewport: { width, height }, colorScheme: scheme });

      test("every section, panel, menu, and question opens and closes, with nothing refused, blocked, thrown, or asked elsewhere", async ({
        page,
        baseURL,
      }) => {
        const problems = await watchClosely(page, new URL(baseURL ?? "").origin);
        await arrive(page);

        // The scheme is a class on the page's root, which every colour of the dashboard is read from.
        await expect(page.locator("html")).toHaveClass(new RegExp(`(^| )${scheme}( |$)`));

        for (const stop of STOPS.filter((each) => each.only === undefined || (each.only === "wide") === wide)) {
          await test.step(stop.name, async () => {
            await stop.open(page, wide);
            for (const shown of stop.shows(page, wide)) await expect(shown).toBeVisible();

            expect.soft(problems.splice(0), stop.name).toEqual([]);
            if (stop.close === undefined) return;

            await stop.close(page);
            for (const shown of stop.shows(page, wide)) await expect(shown).toBeHidden();
          });
        }
      });
    });
  }
}

test.describe("on a screen 1024 px wide", () => {
  test.use({ viewport: FITS_FROM });

  // Drift: the table would be a few pixels wider than its room again and scroll sideways; or its last column would run on past the tools over it, to 12 px from the table's edge where they keep 24.
  test("the sites fit their room with no panel open: a link gives the end of its name, and the last column ends where the tools over the table end", async ({ page }) => {
    await arrive(page);
    await sitesFit(page);
  });
});

test.describe("on a screen 1024 px wide, at the edge of a column", () => {
  test.use({ viewport: FITS_FROM });

  // Drift: a heading's name would carry the names of its tools again; or its edge would be a strip 10 px wide that one engine leaves out of the Tab order, that says no width, and that only a mouse puts back.
  test("a heading is named by its words alone; its edge is the next stop after its grip, 24 px wide, says the column's width, widens it at an arrow key, and puts it back at Enter", async ({ page }) => {
    await arrive(page);
    await sitesFit(page);
    const heading = page.getByRole("table", { name: "Sites", exact: true }).getByRole("columnheader", { name: "Who can open it", exact: true });
    const edge = heading.getByRole("separator", { name: "Resize the Who can open it column", exact: true });
    const drawn = async (): Promise<string> => String(Math.round((await heading.boundingBox())?.width ?? Number.NaN));
    const before = await drawn();

    await heading.getByRole("button", { name: "Move the Who can open it column", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(edge).toBeFocused();
    expect((await edge.boundingBox())?.width).toBe(24);
    await expect(edge).toHaveAttribute("aria-valuenow", before);

    await page.keyboard.press("ArrowRight");
    await expect(edge).toHaveAttribute("aria-valuenow", String(Number(before) + 16));
    expect(await drawn()).toBe(String(Number(before) + 16));

    await page.keyboard.press("Enter");
    await expect(edge).toHaveAttribute("aria-valuenow", before);
    await sitesFit(page);

    // An edge reaches 12 px into the headings at both its sides: no button there may lose a press at either of its ends to it.
    const lost = await page.getByRole("table", { name: "Sites", exact: true }).evaluate((table) =>
      [...table.querySelectorAll("thead button")].flatMap((button) => {
        const box = button.getBoundingClientRect();
        const ends = [box.left + 1, box.right - 1].filter((x) => document.elementFromPoint(x, box.top + box.height / 2)?.role === "separator");

        return ends.length === 0 ? [] : [button.getAttribute("aria-label") ?? button.textContent];
      }),
    );
    expect(lost).toEqual([]);
  });
});

test.describe("on a screen 1920 px wide", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  // Drift: on a wide screen the settings, the users, the tokens, or the pieces of the domain would stretch from edge to edge again, or stand at the left beside an empty right half; or the bar that saves the settings would end at another edge than they do.
  test("the settings, both tabs of Access, and the domain stand in the middle, and the words and buttons of the bar that saves the settings end where they end", async ({ page, browserName }) => {
    await arrive(page);
    // The room at the two sides of a column inside the box it stands in, without that box's own edges, padding, and scrollbar.
    const room = (column: Locator): Promise<{ readonly left: number; readonly right: number }> =>
      column.evaluate((at) => {
        const around = at.parentElement as HTMLElement;
        const [look, box] = [getComputedStyle(around), at.getBoundingClientRect()];
        const start = around.getBoundingClientRect().left + around.clientLeft;

        return {
          left: Math.round(box.left - start - Number.parseFloat(look.paddingLeft)),
          right: Math.round(start + around.clientWidth - Number.parseFloat(look.paddingRight) - box.right),
        };
      });
    const column = page.locator("[data-slot='middle-column']");
    const ways: readonly (readonly [string, () => Promise<void>, Locator])[] = [
      ["Users", () => toSection(page, "Access"), rows(page, true, "Users")],
      ["Tokens", () => page.getByRole("tab", { name: "Tokens", exact: true }).click(), rows(page, true, "Tokens")],
      ["Domain", () => toSection(page, "Domain"), domainLine(page, "Nothing to repair")],
      ["Settings", () => toSection(page, "Settings"), page.getByRole("heading", { name: "New sites", exact: true })],
    ];
    for (const [name, open, shown] of ways) {
      await open();
      await expect(shown).toBeVisible();
      const { left, right } = await room(column.first());

      expect.soft(Math.abs(left - right), name).toBeLessThanOrEqual(1);
      // The control: a column as wide as its room would have equal margins too.
      expect.soft(left, name).toBeGreaterThan(100);
    }

    await page.getByRole("switch", { name: "Show in search engines", exact: true }).click();
    const bar = page.getByRole("region", { name: "Unsaved changes", exact: true });
    await expect(bar).toBeVisible();
    expect(await room(bar.locator(column))).toEqual(await room(column.first()));

    // A scrollbar that takes room narrows the box the settings scroll in: the bar under it keeps the same room. One engine can be told to draw such a scrollbar from the page's start.
    if (browserName !== "chromium") return;

    await page.addInitScript(() => {
      const wide = Object.assign(document.createElement("style"), { textContent: "::-webkit-scrollbar { width: 17px; }" });
      document.addEventListener("DOMContentLoaded", () => document.head.append(wide));
    });
    await page.reload();
    await page.getByRole("switch", { name: "Show in search engines", exact: true }).click();
    await expect(bar).toBeVisible();
    // The control: the scrollbar does take room from the box of the settings.
    expect(await column.first().evaluate((at) => (at.parentElement?.offsetWidth ?? 0) - (at.parentElement?.clientWidth ?? 0))).toBeGreaterThan(0);
    expect(await room(bar.locator(column))).toEqual(await room(column.first()));
  });
});

test.describe("on a screen 1440 px wide, under a site's panel", () => {
  test.use({ viewport: VIEWPORTS[0] });

  // Drift: an open panel would take a column's room from the table again, which was then laid out anew at every open and close; or a press beside the panel would leave it open; or a press on another row would only close it.
  test("the table keeps its width under the panel, a press on another row moves the panel to that site, and a press beside the panel closes it", async ({ page }) => {
    await arrive(page);
    const table = page.getByRole("table", { name: "Sites", exact: true });
    const width = async (): Promise<number> => Math.round((await table.boundingBox())?.width ?? Number.NaN);
    const without = await width();

    await openPanel(page, SAMPLE.site);
    await expect(panel(page).getByRole("heading", { name: SAMPLE.site, exact: true })).toBeVisible();
    expect(await width()).toBe(without);

    await openPanel(page, SAMPLE.graphed);
    await expect(page.getByRole("dialog", { name: SAMPLE.graphed, exact: true })).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    await page.getByRole("searchbox", { name: "Find a site", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await width()).toBe(without);
  });

  // Drift: Escape would leave the focus in the search again after the panel was told to stay once, at a press on another row or on a result's button: the library gives no focus back after a close it was refused.
  test("the focus is back on the row of the site whose panel Escape closed, after the panel moved from another row, came back by the browser's Back, and after Undo was pressed", async ({ page }) => {
    await arrive(page);
    const row = (name: string): Locator => page.getByRole("row").getByRole("button", { name: `Details of ${name}`, exact: true });
    const moved = page.getByRole("dialog", { name: SAMPLE.graphed, exact: true });

    await openPanel(page, SAMPLE.site);
    await openPanel(page, SAMPLE.graphed);
    await moved.getByRole("heading", { name: SAMPLE.graphed, exact: true }).click();
    await pressEscape(page);
    await expect(row(SAMPLE.graphed)).toBeFocused();

    // The panel that Back brings up again was opened by no press: its site's row still takes the focus, not the row pressed last.
    await openPanel(page, SAMPLE.site);
    await openPanel(page, SAMPLE.graphed);
    await page.goBack();
    await panel(page).getByRole("heading", { name: SAMPLE.site, exact: true }).click();
    await pressEscape(page);
    await expect(row(SAMPLE.site)).toBeFocused();

    await openPanel(page, SAMPLE.site);
    await panel(page).getByRole("switch", { name: "Allow embedding", exact: true }).click();
    await lines(page).getByRole("button", { name: "Undo", exact: true }).click();
    await expect(lines(page).filter({ hasText: "Put back." })).toBeVisible();
    await panel(page).getByRole("heading", { name: SAMPLE.site, exact: true }).click();
    await pressEscape(page);
    await expect(row(SAMPLE.site)).toBeFocused();
  });

  // Drift: a site's panel would open from the table at a press on the row alone again, with no control a key or a reader finds: a row with the focus has no role and no name.
  test("each site's row starts with a button named for the site, which opens the panel at Enter and takes the focus back", async ({ page }) => {
    await arrive(page);
    const details = page.getByRole("row").getByRole("button", { name: `Details of ${SAMPLE.site}`, exact: true });

    await details.press("Enter");
    await expect(panel(page).getByRole("heading", { name: SAMPLE.site, exact: true })).toBeFocused();
    await pressEscape(page);
    await expect(details).toBeFocused();
  });

  // Drift: the focus would go under the panel and out of sight again: the end of each row lies under the panel, and a row's controls keep the panel open.
  test("a focus that reaches a row's control under the panel closes the panel and stays there; one on a row's control beside the panel keeps it open", async ({ page }) => {
    await arrive(page);
    const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: `Details of ${SAMPLE.graphed}`, exact: true }) });
    const beside = row.getByRole("button", { name: `Details of ${SAMPLE.graphed}`, exact: true });
    const under = row.getByRole("button", { name: /^Open the site /u });

    await openPanel(page, SAMPLE.site);
    await beside.focus();
    await expect(panel(page)).toBeVisible();

    await under.focus();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(under).toBeFocused();
  });
});

test.describe("on a screen 1440 px wide, where a site's panel lies over more than rows", () => {
  test.use({ viewport: VIEWPORTS[0] });

  // Drift: the focus would go under the panel again on a control that is in no row: the panel lies over the last heading of the table and the end of its tools as well.
  test("a focus that leaves the first row for a heading under the panel, or reaches a tool of the list under it, closes the panel and stays there", async ({ page }) => {
    await arrive(page);
    const first = page.getByRole("row").getByRole("button", { name: /^Details of / }).first();
    const tool = page.getByRole("button", { name: "Columns", exact: true });

    await openPanel(page, SAMPLE.site);
    await first.focus();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("columnheader").last().locator(":focus")).toHaveCount(1);

    await openPanel(page, SAMPLE.site);
    await tool.focus();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(tool).toBeFocused();
  });
});

test.describe("on a phone, at the button of the look", () => {
  test.use({ viewport: PHONE, colorScheme: "light" });

  // Drift: the look would have no way back to the device's again, the button would not say which look is chosen, or the system's look would be read once and stand still while the device changes.
  test("each press moves on from System to Light, to Dark, and to System again, which follows the device as it changes", async ({ page }) => {
    await arrive(page);
    const root = page.locator("html");
    const button = (look: string): Locator => page.getByRole("button", { name: `Theme: ${look}`, exact: true });

    await button("System").click();
    await button("Light").click();
    await expect(button("Dark")).toBeVisible();
    await expect(root).toHaveClass(/(^| )dark( |$)/);
    await page.emulateMedia({ colorScheme: "dark" });

    await button("Dark").click();
    await expect(button("System")).toBeVisible();
    await expect(root).toHaveClass(/(^| )dark( |$)/);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveClass(/(^| )light( |$)/);
  });
});

test.describe("on a phone, while a line says a result", () => {
  test.use({ viewport: PHONE });

  // Drift: a line would lie over the header or the screen's own controls under it again, where a pointer that rests on it keeps it there, and no control under it could be pressed.
  test("the whole line lies under the header and the controls of the screen, and the button of the sections opens them", async ({ page }) => {
    await arrive(page);
    await reset(page);

    // The line slides up into its place, so its place is read until it has come to rest.
    await expect(async () => {
      const [filter, line] = await Promise.all([page.getByRole("combobox", { name: "Which sites", exact: true }).boundingBox(), lines(page).filter({ hasText: "Sample data reset." }).boundingBox()]);

      expect(line?.y).toBeGreaterThanOrEqual((filter?.y ?? Number.NaN) + (filter?.height ?? Number.NaN));
      expect((line?.y ?? Number.NaN) + (line?.height ?? Number.NaN)).toBeLessThanOrEqual(PHONE.height);
    }).toPass();

    await page.getByRole("button", { name: SECTIONS_BUTTON }).click();
    await expect(page.getByRole("navigation", { name: "Sections", exact: true })).toBeVisible();
  });

  // Drift: a result with Undo would lie over the last controls of a site's panel for as long as it stays, where no press reaches New link or Delete, and a second result would lie over more of them.
  test("the last control of a site's panel is pressed after one move of the panel while a result is said, a newer result takes the older one's place, and a result with no button leaves at a press", async ({ page }) => {
    await arrive(page);
    await openPanel(page, SAMPLE.site);
    await panel(page).getByRole("switch", { name: "Allow embedding", exact: true }).click();
    await expect(lines(page).filter({ hasText: "Saved." })).toBeVisible();

    await panel(page).evaluate((scrolls) => scrolls.scrollTo(0, scrolls.scrollHeight));
    await panel(page).getByRole("button", { name: "New link", exact: true }).click({ timeout: 2000 });
    await leaveBy("Cancel")(page);

    await panel(page).getByRole("button", { name: /^Make live: version \d+$/u }).first().click();
    await expect(lines(page).filter({ hasText: /is live now/ })).toBeVisible();
    await expect(lines(page)).toHaveCount(1);

    await toSection(page, "Sites");
    await reset(page);
    await lines(page).filter({ hasText: "Sample data reset." }).click();
    await expect(lines(page)).toHaveCount(0);
  });
});

test.describe("on a phone, after a site's panel", () => {
  test.use({ viewport: PHONE });

  // Drift: the focus would land in the search again: the row's button is out of sight under the panel, and a button that eases its changes is still out of sight at the moment the closed panel gives the focus back.
  test("the focus is back on the row's button that opened the panel, closed with Escape and with Close", async ({ page }) => {
    await arrive(page);
    const details = page.getByRole("button", { name: `Details of ${SAMPLE.site}`, exact: true });
    const heading = panel(page).getByRole("heading", { name: SAMPLE.site, exact: true });

    // A person closes the panel after the list under it has left sight, which is when its button can no longer take the focus.
    await details.press("Enter");
    await expect(heading).toBeFocused();
    await expect(details).toBeHidden();
    await pressEscape(page);
    await expect(details).toBeFocused();

    await details.press("Enter");
    await expect(heading).toBeFocused();
    await expect(details).toBeHidden();
    await panel(page).getByRole("button", { name: "Close: back to sites", exact: true }).click();
    await expect(details).toBeFocused();
  });
});

for (const size of [PHONE, FITS_FROM]) {
  test.describe(`on a screen ${size.width} px wide, where a site's panel takes the list's place`, () => {
    test.use({ viewport: size });

    // Drift: Tab after the panel's last control would stop on a place with no name again, with the panel still open; or Escape would leave the focus on the page itself where the list is a table.
    test("Tab after the panel's last control closes the panel and goes to the row's button, and so does Escape", async ({ page }) => {
      await arrive(page);
      const details = page.getByRole("button", { name: `Details of ${SAMPLE.site}`, exact: true });

      await details.press("Enter");
      await panel(page).getByRole("button", { name: "Delete", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(details).toBeFocused();

      // A person presses Escape after the list has left sight, which is when its button can no longer take the focus.
      await details.press("Enter");
      await expect(panel(page).getByRole("heading", { name: SAMPLE.site, exact: true })).toBeFocused();
      await expect(details).toBeHidden();
      await pressEscape(page);
      await expect(details).toBeFocused();
    });
  });
}

// Drift: the keys would reach Close before Undo again, or the result would name keys that do not lead to it.
test("a result's Undo is reached with the keys the result names, then Tab twice, and Close comes after it", async ({ page }) => {
  await arrive(page);
  await openPanel(page, SAMPLE.site);
  await panel(page).getByRole("switch", { name: "Allow embedding", exact: true }).click();
  const saved = lines(page).filter({ hasText: "Saved." });
  await expect(saved).toContainText("Press Alt+T to reach Undo.");

  await page.keyboard.press("Alt+T");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(saved.getByRole("button", { name: "Undo", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(saved.getByRole("button", { name: "Close", exact: true })).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(lines(page).filter({ hasText: "Put back." })).toBeVisible();
});

// Drift: a move to another screen would leave the focus on the page itself again, where no key reaches anything and nothing is said; or every screen's tab would be named alike.
test("a screen that follows another one gives its title the focus and names the tab, on a wide screen and from a phone's sections; the first Tab stop leads past the sections", async ({ page }) => {
  await arrive(page);
  for (const size of [VIEWPORTS[0], PHONE]) {
    await page.setViewportSize(size);
    for (const screen of ["Activity", "Settings", "Sites"]) {
      await toSection(page, screen);
      await expect(screenHeading(page, screen)).toBeFocused();
      await expect(page).toHaveTitle(`${screen} - poplin`);
    }
  }

  // One engine says a page is loaded before its frame is drawn: a Tab pressed by then finds no control.
  const skip = page.getByRole("button", { name: "Skip to the content", exact: true });
  await page.reload();
  await expect(skip).toBeAttached();
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(screenHeading(page, "Sites")).toBeFocused();
});

// Drift: a group of the settings would take its name from its heading by an id again: Firefox ends the page when such a name is read once by the walk's own scripts and once among the page's.
test("a group of the settings is found by its name twice, by a count and among the page's own scripts, and the page stays", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Settings");
  const group = page.getByRole("region", { name: "New sites", exact: true });

  await expect(group).toHaveCount(1);
  expect(await group.evaluateAll((all) => all.length)).toBe(1);
});

test.describe("on a phone, on Usage", () => {
  test.use({ viewport: PHONE });

  // Drift: the names of the lines would scroll in a room as low as a wide screen's again, which shows two of a dozen where a row holds one name.
  test("with every site picked, five names of the lines or more show at once, and the rest by scrolling", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Usage");
    await pickEverySite(page);
    const names = page.getByRole("list", { name: "Lines", exact: true });
    await expect(names.getByRole("listitem")).not.toHaveCount(1);

    const shown = await wholeNames(names);
    expect({ atOnce: shown.whole >= 5, scrolls: shown.whole < shown.all }).toEqual({ atOnce: true, scrolls: true });
  });

  // Drift: the room of the names would be some pixels short of six rows again, where every name takes a row of its own, and the sixth would be cut.
  test("with nine sites of long titles picked, each name takes a row of its own, and six of them show whole at once", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Usage");
    await pickEverySite(page);
    // A line is named by the title its site was picked with, which the browser keeps: nine are kept, each under a long one.
    await page.evaluate(
      ({ key, title }) => {
        const choice = JSON.parse(localStorage.getItem(key) ?? "{}");
        const sites = choice.sites.slice(0, 9).map((site: object, at: number) => ({ ...site, title: `${title} ${at + 1}` }));
        localStorage.setItem(key, JSON.stringify({ ...choice, sites }));
      },
      { key: VISITS_CHOICE_KEY, title: LONG_TITLE },
    );
    await toSection(page, "Sites");
    await toSection(page, "Usage");
    const names = page.getByRole("list", { name: "Lines", exact: true });
    await expect(names.getByText(`${LONG_TITLE} 9`, { exact: true })).toBeAttached();

    expect(await wholeNames(names)).toEqual({ all: 10, whole: 6, rows: 6 });
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`on Usage, at ${viewport.width} pixels`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    // Drift: the block would take its name from its heading's id again, and Firefox ends a page whose block is read by that name twice; or the one line left would not be drawn.
    test("with one site compared and all sites switched off, the block is still read by its name, and the site's line alone is drawn", async ({ page }) => {
      await arrive(page);
      await toSection(page, "Usage");
      const switches = page.getByRole("region", { name: "Visits", exact: true }).locator("button[aria-pressed]");
      await tickSite(page);
      await expect(switches).toHaveCount(2);

      await switches.first().click();
      await expect(page.locator("path[data-line]")).toHaveCount(1);

      const after = await switches.evaluateAll((all) => all.map((one) => [one.getAttribute("aria-pressed"), (one as HTMLButtonElement).disabled]));
      expect(after).toEqual([
        ["false", false],
        ["true", true],
      ]);
      const drawn = await page.locator("path[data-line]").evaluate((line) => (line.getAttribute("d") ?? "").split(/[ML,]/).filter(Boolean).map(Number));
      expect(drawn.every(Number.isFinite) && drawn.length > 2).toBe(true);
    });
  });
}

test.describe("on a phone, on Activity", () => {
  test.use({ viewport: PHONE });

  // Drift: a phone's rows would end with no button again, and typing a site's title would be the one way to that site's entries.
  test("a row about a site ends with Only this site, which keeps that site's entries under a mark that names it", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Activity");
    const entries = page.getByRole("list", { name: "Activity", exact: true }).getByRole("listitem");
    const ofSite = page.getByRole("link", { name: SAMPLE.site, exact: true });

    await entries.filter({ has: ofSite }).first().getByRole("button", { name: /^Only /u }).click();
    await expect(page.getByText(`Only ${SAMPLE.site}`, { exact: true })).toBeVisible();
    await expect(entries.filter({ hasNot: ofSite })).toHaveCount(0);
    await expect(entries.filter({ has: ofSite })).not.toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Only /u })).toHaveCount(0);
  });

  // Drift: one engine would cut the end off a site's name again though the row has room for it: the name's link reaches past the box that cuts it by the link's own edges.
  test("a site's name in a row with room for it is whole", async ({ page }) => {
    await arrive(page);
    await toSection(page, "Activity");
    const names = page.getByRole("list", { name: "Activity", exact: true }).getByRole("link");
    await expect(names.first()).toBeVisible();
    const cut = await names.evaluateAll((links) => links.filter((link) => (link.parentElement?.scrollWidth ?? 0) > (link.parentElement?.clientWidth ?? 0)).map((link) => link.textContent));

    expect([await names.count() > 0, cut]).toEqual([true, []]);
  });
});

for (const viewport of SMALL_PHONES) {
  test.describe(`on a phone of ${viewport.width}x${viewport.height}, in the sections`, () => {
    test.use({ viewport });

    // Drift: the sheet of the sections would not scroll again, and on a screen shorter than what it holds the start of an update would lie under its edge, out of reach; or the button that closes the sheet would scroll away with its top.
    test("the start of an update can be reached and pressed, by scrolling where the sheet is too short, with the way to close the sheet still in sight", async ({ page }) => {
      await arrive(page);
      await page.getByRole("button", { name: SECTIONS_BUTTON }).click();
      const start = page.getByRole("dialog").getByRole("button", { name: "Update now", exact: true });

      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })).toBeInViewport({ ratio: 1 });
      await start.click();
      await expect(question(page, /^Update to /)).toBeVisible();
    });
  });
}

test.describe("on a phone, in a question", () => {
  test.use({ viewport: PHONE });

  // Drift: a question that leads with not doing it would draw its filled button under the other one again, where every other question has it on top.
  test("the filled button is the upper one, also where not doing it leads", async ({ page }) => {
    await arrive(page);
    const upper = async (): Promise<Locator> => {
      const buttons = page.getByRole("alertdialog").getByRole("button");
      await expect(buttons).toHaveCount(2);
      const [first, second] = await Promise.all([buttons.first().boundingBox(), buttons.last().boundingBox()]);

      return (first?.y ?? Number.NaN) < (second?.y ?? Number.NaN) ? buttons.first() : buttons.last();
    };

    await openPanel(page, SAMPLE.site);
    await panel(page).getByRole("button", { name: "New link", exact: true }).click();
    await expect(await upper()).toHaveText("Make a new link");
    await expect(await upper()).toHaveClass(FILLED);
    await leaveBy("Cancel")(page);

    await toSection(page, "Settings");
    await page.getByRole("textbox", { name: "Keep deleted sites", exact: true }).fill("9");
    await toSection(page, "Sites");
    await expect(await upper()).toHaveText("Stay");
    await expect(await upper()).toHaveClass(FILLED);
  });
});

// Drift: one press on Private would end a public link again with nothing asked, and a public name typed as a link ends would get that ending twice with nothing said.
test("a public site is asked about before its public link ends, Cancel leaves it public, and the question that makes a site public shows the link a typed name gets", async ({ page }) => {
  const handbook = page.getByRole("dialog", { name: SAMPLE.graphed, exact: true });
  const asks = page.getByRole("dialog", { name: `Make ${SAMPLE.graphed} public?`, exact: true });
  await arrive(page);
  await openPanel(page, SAMPLE.graphed);

  await handbook.getByRole("button", { name: "Private", exact: true }).click();
  await expect(question(page, `Make ${SAMPLE.graphed} private?`)).toContainText("Its public link stops working.");
  await leaveBy("Cancel")(page);
  await expect(handbook.getByRole("button", { name: "Public", exact: true })).toHaveAttribute("aria-pressed", "true");

  await handbook.getByRole("button", { name: "Unlisted", exact: true }).click();
  await leaveBy("Make it unlisted")(page);
  await expect(handbook.getByRole("button", { name: "Unlisted", exact: true })).toHaveAttribute("aria-pressed", "true");
  await handbook.getByRole("button", { name: "Public", exact: true }).click();
  await asks.getByRole("textbox", { name: "Public name", exact: true }).fill("handbook-page");
  await expect(asks.getByText(/handbook-page-page$/)).toBeVisible();
});

// Drift: a change would leave the focus on the page itself again, where no key reaches anything: the control that held it is gone once the change is done.
test("after a change the focus is where the next key is of use: the panel's heading, also after Undo, the refused field, the button that adds a user, another page's first row, the button of one site's mark, a reset setting's field", async ({ page }) => {
  await arrive(page);
  await openPanel(page, SAMPLE.site);
  await panel(page).getByRole("button", { name: /^Make live: version \d+$/u }).first().click();
  await expect(page.getByText(/is live now/)).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: SAMPLE.site, exact: true })).toBeFocused();

  // The button of a result leaves with its result.
  await lines(page).filter({ hasText: /is live now/ }).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(lines(page).filter({ hasText: /is live now/ })).toHaveCount(1);
  await expect(panel(page).getByRole("heading", { name: SAMPLE.site, exact: true })).toBeFocused();

  await panel(page).getByRole("button", { name: "Edit", exact: true }).click();
  const name = editDialog(page).getByRole("textbox", { name: "Name", exact: true });
  await name.fill("a");
  await editDialog(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();
  await cancelDialog(page);

  // A question with a field gives the focus back to the control that asked it: on the row behind the panel, the next Escape would close the panel.
  await expect(panel(page).getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await panel(page).getByRole("button", { name: "Public", exact: true }).press("Enter");
  await expect(asksPublicName(page)).toBeVisible();
  await pressEscape(page);
  await expect(panel(page).getByRole("button", { name: "Public", exact: true })).toBeFocused();

  // A dialog opened by a key puts the focus on its Copy button, whose hint then shows: one Escape still closes the dialog.
  await toSection(page, "Access");
  await page.getByRole("tab", { name: "Tokens", exact: true }).click();
  await page.getByRole("button", { name: "Add a token", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Copy the command", exact: true })).toBeFocused();
  await pressEscape(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await toSection(page, "Access");
  await page.getByRole("button", { name: "Add a user", exact: true }).click();
  await addPerson(page).getByRole("textbox", { name: "Email", exact: true }).fill(TYPED_EMAIL);
  await addPerson(page).getByRole("button", { name: "Add a user", exact: true }).click();
  await expect(addPerson(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Add a user", exact: true })).toBeFocused();

  // The way to another page is off on the page it led to, and the row's button that narrows the log leaves once it is narrowed.
  const log = page.getByRole("region", { name: "Activity", exact: true });
  await toSection(page, "Activity");
  await log.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(log.getByRole("button", { name: "First page", exact: true })).toBeEnabled();
  await expect(log.locator("tbody > tr").first()).toBeFocused();
  await log.getByRole("button", { name: /^Only /u }).first().click();
  await expect(log.getByRole("button", { name: "Show every site", exact: true })).toBeFocused();

  // Reset leaves once the default is back.
  const perDay = page.getByRole("textbox", { name: "Requests per day", exact: true });
  await toSection(page, "Settings");
  await perDay.fill("1234");
  await page.locator("#setting-requests_per_day").getByRole("button", { name: "Reset Requests per day", exact: true }).click();
  await expect(perDay).toBeFocused();
});

// Drift: a row reached by a key would show the pointer's tint alone again: a class that turns a row's outline off also turns off the one asked for with the focus, and a ring of the row's own lies under the cells that stay in place.
test("a site's row that takes the focus from a key draws a ring on all four sides, by its cells", async ({ page }) => {
  await arrive(page);
  const row = page.getByRole("table", { name: "Sites", exact: true }).locator("tbody > tr").first();
  // A key before the focus is what tells the engine to show it. The row's own button takes the focus, and the row draws the ring for it.
  await page.keyboard.press("Tab");
  await row.getByRole("button", { name: /^Details of /u }).focus();

  const edges = await row.evaluate((focused) => [...focused.children].map((cell) => getComputedStyle(cell).boxShadow.split("inset").length - 1));
  expect({ first: edges.at(0), between: [...new Set(edges.slice(1, -1))], last: edges.at(-1) }).toEqual({ first: 3, between: [2], last: 3 });
});

// Drift: one screen would draw a rule under its header again where the others draw none, so the six would not start alike.
test("no screen draws a rule between its header and what follows it", async ({ page }) => {
  await arrive(page);
  for (const stop of screens()) {
    await toScreen(page, stop);
    const header = page.locator("header").filter({ has: screenHeading(page, stop.screen) });

    await expect.soft(header, stop.screen).toHaveCSS("border-bottom-width", "0px");
    await expect.soft(header.locator("xpath=following-sibling::*[1]"), stop.screen).toHaveCSS("border-top-width", "0px");
  }
});

// Drift: a group's heading would be set larger than the screen's own title again, so the page would read as if the group were the screen.
test("no heading of a screen is larger than the screen's title", async ({ page }) => {
  await arrive(page);
  const larger: Record<string, (string | null)[]> = {};
  for (const stop of screens()) {
    await toScreen(page, stop);
    larger[stop.screen] = await screenHeading(page, stop.screen).evaluate((title) => {
      const size = (heading: Element): number => Number.parseFloat(getComputedStyle(heading).fontSize);

      return [...document.querySelectorAll("h2, h3, h4")].filter((heading) => size(heading) > size(title)).map((heading) => heading.textContent);
    });
  }

  expect(larger).toEqual(Object.fromEntries(screens().map((stop) => [stop.screen, []])));
});

// Drift: the filter at a row's end would search for a name again: the entries from before a new link or a rename would be gone, and those of another site of that name shown.
test("on Activity, Only this site keeps the entries of the row's site, the first one from before its new link among them, under a mark that names the site, and the mark's button shows every site again", async ({ page }) => {
  await arrive(page);
  await openPanel(page, SAMPLE.site);
  await panel(page).getByRole("button", { name: "New link", exact: true }).click();
  await question(page, "Make a new link?").getByRole("button", { name: "Make a new link", exact: true }).click();
  await expect(said(page, "The site has a new link. The old link stopped working.")).toBeVisible();

  await toSection(page, "Activity");
  const log = rows(page, true, "Activity").locator("tbody");
  const mark = page.getByText(`Only ${SAMPLE.site}`, { exact: true });
  const ofSite = page.getByRole("link", { name: SAMPLE.site, exact: true });
  await log.getByRole("row").filter({ hasText: "Made a new link", has: ofSite }).getByRole("button", { name: /^Only /u }).click();
  await expect(mark).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: "Made the site" })).toHaveCount(1);
  await expect(log.getByRole("row").filter({ hasNot: ofSite })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Only /u })).toHaveCount(0);

  await page.getByRole("button", { name: "Show every site", exact: true }).click();
  await expect(mark).toBeHidden();
  await expect(log.getByRole("row").filter({ hasNot: ofSite })).not.toHaveCount(0);
});

// Drift: the list would follow the sites' names again, which it shows second and in grey, so its titles would stand in no order a person can see.
test("the list that picks the sites of the graph stands in the order of the titles it shows first", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Usage");
  await page.getByRole("combobox", { name: "Compare sites", exact: true }).click();
  await expect(page.getByRole("option").first()).toBeVisible();

  const titles = await page.getByRole("option").evaluateAll((options) => options.map((option) => option.firstElementChild?.textContent ?? ""));
  expect(titles).toContain(SAMPLE.graphed);
  expect(titles).toEqual([...titles].sort((left, right) => (left.toLowerCase() < right.toLowerCase() ? -1 : 1)));
});

// Drift: what went wrong would be remembered and shown nowhere: no mark at the side, no list on Usage, a row that opens nothing, or details that cannot be copied into a report.
test("a section whose screen holds a problem says so at the side, Usage lists what went wrong, a row opens its panel, the panel's details are copied, and Escape gives the focus back to the row", async ({ page }) => {
  await arrive(page);
  const sections = page.getByRole("navigation", { name: "Sections", exact: true });
  await expect(sections.getByRole("link", { name: "Usage 2 problems", exact: true })).toBeVisible();
  await expect(sections.getByRole("link", { name: "Domain 1 problem", exact: true })).toBeVisible();
  await expect(sections.getByRole("link", { name: "Settings", exact: true })).toBeVisible();

  await toSection(page, "Usage");
  await rows(page, true, "Problems").getByText("A request failed", { exact: true }).click();
  const panel = page.getByRole("complementary", { name: "A request failed", exact: true });
  await expect(panel.getByText("What to do", { exact: true })).toBeVisible();
  await expect(panel.getByText(/ 12\+ times\.$/)).toBeVisible();

  // The walk's own clipboard takes the copy: an engine may let no page write to the real one, and the text is what matters.
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => void document.body.setAttribute("data-copied", text) }, configurable: true }));
  await panel.getByRole("button", { name: "Copy the details", exact: true }).click();
  await expect(said(page, "Details copied.")).toBeVisible();
  expect((await page.locator("body").getAttribute("data-copied"))?.split("\n").slice(0, 2)).toEqual([expect.stringMatching(/^poplin \S+: request_failed$/), "A request failed"]);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(rows(page, true, "Problems").getByRole("button", { name: "Details of A request failed", exact: true })).toBeFocused();

  await toSection(page, "Domain");
  await expect(page.getByRole("group", { name: "The login could not be checked", exact: true }).getByRole("button", { name: "Copy the details", exact: true })).toBeVisible();
});

// Drift: Enter after typing would tick nothing again, or tick the first site of the list from before the typed text, which the text does not find.
test("in the list that picks the sites of the graph, Enter ticks the site the typed text finds, and none of the list before it", async ({ page }) => {
  await arrive(page);
  await toSection(page, "Usage");
  await page.getByRole("combobox", { name: "Compare sites", exact: true }).click();
  const find = page.getByRole("combobox", { name: "Find a site", exact: true });
  const lines = page.getByRole("list", { name: "Lines", exact: true });

  await find.fill(SAMPLE.site);
  await expect(page.getByRole("option")).toHaveText([new RegExp(`^${SAMPLE.site}`)]);
  // The list still holds the first text's site when Enter follows the second text at once.
  await find.fill(SAMPLE.graphed);
  await find.press("Enter");
  await expect(page.getByRole("option")).toHaveText([new RegExp(`^${SAMPLE.graphed}`)]);
  await expect(lines.getByText(SAMPLE.site, { exact: true })).toHaveCount(0);

  await find.press("Enter");
  await expect(lines.getByText(SAMPLE.graphed, { exact: true })).toBeVisible();
  await expect(lines.getByText(SAMPLE.site, { exact: true })).toHaveCount(0);
});

// Drift: the figures of a column would be as wide as their shapes again, or come from whatever the visitor's machine has, so its times and numbers would end at different places row by row.
test("two times of the same length take the same room in the face the dashboard carries, where its own face alone gives each its own", async ({ page }) => {
  await arrive(page);

  const measured = await page.evaluate(
    async ([times, figures, ownFace]) => {
      const carried = await document.fonts.load(`14px ${figures}`, "0");
      // The control is measured in the dashboard's own face, so that one has to be there too: a face that stands in for it may draw its figures at one width.
      await document.fonts.load(`14px ${ownFace}`, times[0]);
      const widthOf = (text: string, family: string): number => {
        const span = document.createElement("span");
        span.textContent = text;
        span.style.cssText = `position:absolute;white-space:nowrap;font-family:${family}`;
        document.body.append(span);
        const { width } = span.getBoundingClientRect();
        span.remove();

        return width;
      };

      return {
        carried: carried.map((face) => face.status),
        // One engine writes the name with its quotes, another without.
        first: getComputedStyle(document.body).fontFamily.replaceAll('"', "").startsWith(figures.replaceAll('"', "")),
        // No face of the machine is named: where the carried one did not load, the figures fall to the dashboard's own, and the widths differ.
        shown: times.map((time) => widthOf(time, `${figures}, ${ownFace}`)),
        control: times.map((time) => widthOf(time, ownFace)),
      };
    },
    [TIMES, FIGURES, OWN_FACE] as const,
  );

  expect([measured.carried, measured.first]).toEqual([["loaded"], true]);
  expect(measured.shown[0]).toBe(measured.shown[1]);
  expect(measured.control[0]).not.toBe(measured.control[1]);
});

// Drift: a site could be told when to delete itself from a terminal alone, or the panel would show a span where the day it ends on is asked for.
test("in a site's panel, a span is shown as the moment it ends before it is saved and after, Undo takes it away again, and a day is picked in a dialog that one Escape leaves", async ({ page }) => {
  const fact = panel(page).locator("dd").filter({ has: page.getByRole("button", { name: "Change when it deletes itself", exact: true }) });
  const change = panel(page).getByRole("button", { name: "Change when it deletes itself", exact: true });
  await arrive(page);
  await openPanel(page, SAMPLE.site);
  await expect(fact).toHaveText("NeverChange");

  await change.click();
  await expect(page.getByRole("menuitem")).toHaveText([new RegExp(`^1 day${MOMENT}$`), new RegExp(`^7 days${MOMENT}$`), new RegExp(`^30 days${MOMENT}$`), "On a day...", "Never"]);
  await page.getByRole("menuitem", { name: /^7 days/ }).click();
  await expect(said(page, "Saved.")).toBeVisible();
  await expect(fact).toHaveText(new RegExp(`^${MOMENT}ChangeThen its link stops working, and it moves to the trash\\.$`));

  await lines(page).filter({ hasText: "Saved." }).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(said(page, "Put back.")).toBeVisible();
  await expect(fact).toHaveText("NeverChange");

  await change.click();
  await page.getByRole("menuitem", { name: "On a day...", exact: true }).click();
  const day = page.getByRole("dialog", { name: "Pick a day", exact: true });
  await expect(day.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await day.getByRole("gridcell").getByRole("button", { disabled: false }).first().click();
  await expect(day.getByText(/^Deletes itself \d{2} [A-Z][a-z]{2} \d{4}, 00:00$/)).toBeVisible();
  await pressEscape(page);
  await expect(day).toBeHidden();
  await expect(change).toBeFocused();
  await expect(fact).toHaveText("NeverChange");
});

// Drift: a site in the trash could be removed for good from a terminal alone, or one press would remove it, with its title where its name is asked for.
test("a site in the trash is deleted for good only once its name is typed, with the focus on Cancel first; it then leaves the list with no Undo, and Activity says so", async ({ page }) => {
  const asks = question(page, `Delete ${TRASHED.title} for good?`);
  const remove = asks.getByRole("button", { name: "Delete for good", exact: true });
  await arrive(page);
  await page.goto(TRASH);
  // The way out for good is in the site's panel, which the row's own button opens.
  await page.getByRole("row").getByRole("button", { name: `Details of ${TRASHED.title}`, exact: true }).press("Enter");
  await page.getByRole("dialog", { name: TRASHED.title, exact: true }).getByRole("button", { name: "Delete for good", exact: true }).click();
  await expect(asks.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(remove).toBeDisabled();

  await asks.getByRole("textbox", { name: "Site's name", exact: true }).fill(TRASHED.title);
  await expect(remove).toBeDisabled();
  await asks.getByRole("textbox", { name: "Site's name", exact: true }).fill(TRASHED.name);
  await remove.click();
  await expect(said(page, `${TRASHED.title} deleted for good.`)).toBeVisible();
  await expect(siteName(page, TRASHED.title)).toHaveCount(0);
  await expect(lines(page).getByRole("button")).toHaveCount(0);
  await expect(page.getByLabel("Find a site", { exact: true }).filter({ visible: true })).toBeFocused();

  await toSection(page, "Activity");
  await expect(page.locator(':text-is("Deleted for good"):visible').first()).toBeVisible();
});

// Drift: a search or a filter would change a list's rows with nothing said to a screen reader again; or a second search that finds as many rows would be said in the same words, which is not said at all.
test("a list says how many rows it shows, and that it shows none, each time it is searched", async ({ page }) => {
  await arrive(page);
  const sites = page.locator('section[aria-label="Sites"] output');
  const findSite = page.getByRole("searchbox", { name: "Find a site", exact: true });
  await expect(sites).toHaveText(/^\d+ sites( on this page)?$/u);
  await findSite.fill("zzzz");
  await expect(sites).toHaveText('No sites match "zzzz"');
  // Two searches that each find one site are said apart: the line names what was searched for.
  await findSite.fill(SAMPLE.site);
  await expect(sites).toHaveText(`1 site, "${SAMPLE.site}"`);
  await findSite.fill(SAMPLE.graphed);
  await expect(sites).toHaveText(`1 site, "${SAMPLE.graphed}"`);

  await toSection(page, "Activity");
  const log = page.locator('section[aria-label="Activity"] output');
  await expect(log).toHaveText(/^\d+ entries( on this page)?$/u);
  await page.getByRole("searchbox", { name: "Find activity by a site's title or name", exact: true }).fill("zzzz");
  await expect(log).toHaveText('No activity for "zzzz"');
});

// Drift: a list other than the sites would let its columns be dragged and resized again, which only the table of the sites does.
test("only the table of the sites has headings to move and edges to resize: every other table stands as it is", async ({ page }) => {
  const tools = (name: string): Promise<number[]> =>
    Promise.all([
      page.getByRole("table", { name, exact: true }).getByRole("separator").count(),
      page.getByRole("table", { name, exact: true }).getByRole("button", { name: /^Move the /u }).count(),
    ]);
  await arrive(page);
  await expect(page.getByRole("table", { name: "Sites", exact: true }).getByRole("separator").first()).toBeAttached();
  const found: Record<string, number[]> = { Sites: await tools("Sites") };

  for (const [section, table] of [
    ["Activity", "Activity"],
    ["Usage", "Usage"],
    ["Access", "Users"],
    ["Domain", "Pieces"],
  ] as const) {
    await toSection(page, section);
    await expect(page.getByRole("table", { name: table, exact: true }).getByRole("columnheader").first()).toBeVisible();
    found[table] = await tools(table);
  }

  expect({ ...found, Sites: found.Sites?.map((count) => count > 0) }).toEqual({ Sites: [true, true], Activity: [0, 0], Usage: [0, 0], Users: [0, 0], Pieces: [0, 0] });
});

// Drift: a copy could only be made from a terminal; or the dashboard's copy would keep the source's access, drop a refused name, or leave no way to the new site.
test("a site is duplicated from its panel: a refused name stays in its field, the copy is said as done with the way to its own panel, and it is a private site of its own in the list", async ({ page }) => {
  const asks = page.getByRole("dialog", { name: `Duplicate ${SAMPLE.site}?`, exact: true });
  const name = asks.getByRole("textbox", { name: "Name", exact: true });
  await arrive(page);
  await openPanel(page, SAMPLE.site);
  await panel(page).getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(asks).toContainText("The copy starts private.");
  await expect(name).toHaveValue("pricing");

  await name.fill("Pricing Copy");
  await asks.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(asks.getByText(/^The name breaks the rules/)).toBeVisible();
  await expect(name).toHaveValue("Pricing Copy");

  await name.fill("pricing-copy");
  await asks.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(said(page, "Duplicated.")).toBeVisible();
  await expect(siteName(page, SAMPLE.site)).toHaveCount(2);

  await lines(page).getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/sites\/pricing-copy--[0-9a-z]{12}$/);
  await expect(panel(page).getByRole("button", { name: "Private", exact: true })).toHaveAttribute("aria-pressed", "true");
});
