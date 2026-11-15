// The link walk: every place the dashboard's own controls lead to, on a wide screen and on a phone, in the light scheme and in the dark one. A question is opened and left. One token is removed near the end, and the last stop starts the sample data over.

import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, openPanel, said, screenHeading, siteName, test } from "./visit";

/** The screens the walk is taken on. A wide one shows tables and the side navigation; a narrow one shows lists, and the sections behind a button. */
const VIEWPORTS = [
  { width: 1440, height: 900, wide: true },
  { width: 390, height: 844, wide: false },
] as const;

/** The schemes a browser asks for. The dashboard follows the browser until a theme is chosen with the switch at the top. */
const SCHEMES = ["light", "dark"] as const;

/** What the sample data holds that the walk opens: an unlisted site by its title, a site by its title for the graph, a person who is not the visitor, a token, and a login that waits. */
const SAMPLE = { site: "Pricing", graphed: "Team handbook", person: "jonas@example.com", token: "design-laptop", login: "build-server" } as const;

/** Where the notes of a newer version are read: the page of the project's releases. */
const RELEASES = "https://github.com/Vivswan/poplin/releases";

/** An email typed into the dialog that adds a user, and never sent. */
const TYPED_EMAIL = "walk@example.com";

/** The kinds of file whose refusal breaks a screen. */
const NEEDED_KINDS = ["document", "script", "stylesheet", "font"];

/** The path every read and change of the dashboard's data goes to. */
const DATA_PATH = "/data/";

/** Every place of the walk, in the order it is taken: each starts where the one before it ended. */
const STOPS: readonly Stop[] = [
  {
    name: "Sites, from the side",
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
    open: (page) => toSection(page, "Domain"),
    shows: (page) => [screenHeading(page, "Domain"), page.getByRole("status").filter({ hasText: "Nothing to repair" })],
  },
  {
    name: "the token a repair asks for",
    open: (page) => page.getByRole("button", { name: "Repair", exact: true }).click(),
    shows: (page) => [
      page.getByRole("dialog", { name: "Repair the domain", exact: true }).getByRole("button", { name: "Open the token form", exact: true }),
      page.getByRole("dialog", { name: "Repair the domain", exact: true }).getByLabel("Token", { exact: true }),
    ],
    close: (page) => page.getByRole("dialog", { name: "Repair the domain", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click(),
  },
  {
    name: "the trash, from the filter of Sites",
    open: async (page) => {
      await toSection(page, "Sites");
      await narrowSites(page, "Trash");
    },
    shows: (page) => [page.getByRole("button", { name: "Restore", exact: true }).first()],
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
    name: "the title and the name, from a row's menu",
    open: (page) => fromRowMenu(page, SAMPLE.site, "Edit"),
    shows: (page) => [
      editDialog(page).getByRole("textbox", { name: "Title", exact: true }),
      editDialog(page).getByRole("textbox", { name: "Name", exact: true }),
    ],
    close: cancelDialog,
  },
  {
    name: "New link, from a row's menu",
    open: (page) => fromRowMenu(page, SAMPLE.site, "New link"),
    shows: (page) => [question(page, "Make a new link?")],
    close: leaveBy("Cancel"),
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
    shows: (page) => [editDialog(page).getByRole("textbox", { name: "Name", exact: true })],
    close: cancelDialog,
  },
  {
    name: "New link, from the panel",
    open: (page) => panel(page).getByRole("button", { name: "New link", exact: true }).click(),
    shows: (page) => [question(page, "Make a new link?")],
    close: leaveBy("Cancel"),
  },
  {
    name: "the question before a site is opened wider",
    open: (page) => panel(page).getByRole("button", { name: "Public", exact: true }).click(),
    shows: (page) => [question(page, `Make ${SAMPLE.site} public?`)],
    close: leaveBy("Cancel"),
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
    name: "the account's menu",
    open: (page) => page.getByRole("button", { name: /^Account/ }).click(),
    shows: (page) => [page.getByRole("menuitem", { name: "Use system theme", exact: true })],
    close: pressEscape,
  },
  {
    name: "the question before an update, from the side",
    only: "wide",
    open: (page) => page.getByRole("button", { name: "Update now", exact: true }).click(),
    shows: (page) => [question(page, /^Update to /)],
    close: leaveBy("Cancel"),
  },
  {
    name: "the question before an update, from the account's menu",
    only: "narrow",
    open: async (page) => {
      await page.getByRole("button", { name: /^Account/ }).click();
      await page.getByRole("menuitem", { name: /^Update to / }).click();
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
    close: leaveBy("Keep"),
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
    close: leaveBy("Keep"),
  },
  {
    name: "a removed token, which then stands under Removed tokens",
    open: async (page) => {
      await fromRowMenu(page, SAMPLE.token, "Remove");
      await leaveBy("Remove")(page);
      await page.getByRole("button", { name: /^Removed tokens/ }).click();
    },
    shows: (page, wide) => [rows(page, wide, "Removed tokens").getByText(SAMPLE.token, { exact: true })],
  },
  {
    name: "the review of a waiting login",
    open: (page) => page.getByRole("button", { name: `Review ${SAMPLE.login}`, exact: true }).click(),
    shows: (page) => [
      page
        .getByRole("dialog", { name: `Allow ${SAMPLE.login}?`, exact: true })
        .getByRole("checkbox", { name: "The codes match", exact: true }),
    ],
    close: (page) =>
      page
        .getByRole("dialog", { name: `Allow ${SAMPLE.login}?`, exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click(),
  },
  {
    name: "a reset of the sample data, which keeps the screen it was pressed on",
    open: (page) => page.getByRole("button", { name: "Reset", exact: true }).click(),
    shows: (page) => [said(page, "Sample data reset."), screenHeading(page, "Access")],
  },
];

/** One place of the walk. */
interface Stop {
  /** What is opened, in the words a failure is reported under. */
  readonly name: string;

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

  expect([file.suggestedFilename(), first]).toEqual([expect.stringMatching(/^poplin-activity-\d{4}-\d{2}-\d{2}\.csv$/), "When (UTC),Who,What,Site,Action"]);
}

/** Go to a section by its entry at the side, which a narrow screen keeps behind a button. */
async function toSection(page: Page, label: string): Promise<void> {
  const behind = page.getByRole("button", { name: "Sections", exact: true });
  if (await behind.isVisible()) await behind.click();

  await page.getByRole("navigation", { name: "Sections", exact: true }).getByRole("link", { name: label, exact: true }).click();
}

/** The rows of a screen: a table on a wide screen, a list on a narrow one, under the same name. */
function rows(page: Page, wide: boolean, name: string): Locator {
  return page.getByRole(wide ? "table" : "list", { name, exact: true });
}

/** Choose what the Sites screen is narrowed to. */
async function narrowSites(page: Page, filter: string): Promise<void> {
  await page.getByRole("combobox", { name: "Which sites", exact: true }).click();
  await page.getByRole("option", { name: filter, exact: true }).click();
}

/** Press one entry of the menu at the end of a row, which is named after what the row holds. */
async function fromRowMenu(page: Page, row: string, entry: string): Promise<void> {
  await page.getByRole("button", { name: `More for ${row}`, exact: true }).click();
  await page.getByRole("menuitem", { name: entry, exact: true }).click();
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

/** The panel of the sample site: beside the table on a wide screen, over the list on a narrow one. */
function panel(page: Page): Locator {
  return page.getByRole("dialog", { name: SAMPLE.site, exact: true });
}

/** A question that asks before a change. */
function question(page: Page, title: string | RegExp): Locator {
  return page.getByRole("alertdialog", { name: title, exact: true });
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
