// The link walk: every place the dashboard's own controls lead to, on a wide screen and on a phone, in the light scheme and in the dark one. A question is opened and left. One token is removed near the end, and the last stop starts the sample data over.

import { readFile } from "node:fs/promises";

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, openPanel, reset, said, screenHeading, siteName, test } from "./visit";

/** The screens the walk is taken on. A wide one shows tables and the side navigation; a narrow one shows lists, and the sections behind a button. */
const VIEWPORTS = [
  { width: 1440, height: 900, wide: true },
  { width: 390, height: 844, wide: false },
] as const;

/** The narrowest screen the Sites table fits with no panel open. */
const FITS_FROM = { width: 1024, height: 768 };

/** The narrow one of them alone: a phone. */
const PHONE = { width: VIEWPORTS[1].width, height: VIEWPORTS[1].height };

/** The schemes a browser asks for. The dashboard follows the browser until a theme is chosen with the switch at the top. */
const SCHEMES = ["light", "dark"] as const;

/** What the sample data holds that the walk opens: an unlisted site by its title, a site by its title for the graph, a person who is not the visitor, a token, and a login that waits. */
const SAMPLE = { site: "Pricing", graphed: "Team handbook", person: "jonas@example.com", token: "design-laptop", login: "build-server" } as const;

/** Where the notes of a newer version are read: the page of the project's releases. */
const RELEASES = "https://github.com/Vivswan/poplin/releases";

/** An email typed into the dialog that adds a user: no user of the sample data has it. */
const TYPED_EMAIL = "walk@example.com";

/** A user the walk adds and then removes. */
const ADDED_EMAIL = "walk-user@example.com";

/** What the Domain screen says at its top once a user was added or removed, until a repair. */
const USERS_CHANGED = "Users changed. Press Repair.";

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
    shows: (page) => [screenHeading(page, "Domain"), domainLine(page, "Nothing to repair")],
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
    open: reset,
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

  expect([file.suggestedFilename(), first]).toEqual([expect.stringMatching(/^poplin-activity-\d{4}-\d{2}-\d{2}\.csv$/), "When (UTC),Who,What,Site,Title,Action"]);
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

/** Check that the Sites table is as wide as its room, with the end of its last column where the rows' actions begin. */
async function sitesFit(page: Page): Promise<void> {
  // The table is measured again once the page's fonts are in, so its widths are read until they have come to rest.
  await expect(async () => {
    const widths = await page.getByRole("table", { name: "Sites", exact: true }).evaluate((table) => {
      const [last, actions] = [...(table.querySelector("tbody tr")?.children ?? [])].slice(-2).map((cell) => cell.getBoundingClientRect());

      return { table: table.scrollWidth, room: table.closest('[data-slot="scroll-area"]')?.clientWidth, underActions: (last?.right ?? Number.NaN) - (actions?.left ?? Number.NaN) };
    });

    expect(widths).toEqual({ table: widths.room, room: widths.room, underActions: 0 });
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
  await dialog.getByLabel("Token", { exact: true }).fill("sample-token");
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

/** The panel of the sample site: beside the table on a wide screen, over the list on a narrow one. */
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

  // Drift: the table would be a few pixels wider than its room again, so it would scroll sideways with the end of its last column under the rows' actions.
  test("the sites fit their room with no panel open: a link gives the end of its name, and no cell lies under the rows' actions", async ({ page }) => {
    await arrive(page);
    await sitesFit(page);
  });
});

test.describe("on a screen 1440 px wide, beside a site's panel", () => {
  test.use({ viewport: VIEWPORTS[0] });

  // Drift: the panel takes the room of a column, and the table would scroll sideways again with the end of its last column under the rows' actions; or the name in a link would be cut while dots still stand for more than a few letters of its id.
  test("the sites fit their room: the dots of a hidden id give, each name stays whole, and no cell lies under the rows' actions", async ({ page }) => {
    await arrive(page);
    await openPanel(page, SAMPLE.site);
    await expect(panel(page).getByRole("heading", { name: SAMPLE.site, exact: true })).toBeVisible();
    await sitesFit(page);

    const links = await page.getByRole("table", { name: "Sites", exact: true }).evaluate((table) => {
      const parts = [...table.querySelectorAll<HTMLElement>("[data-gives]")];
      const names = parts.filter((part) => part.matches(".truncate"));
      // The dots that find no room stand in a line under the first, which is not shown.
      const dots = parts.filter((part) => !part.matches(".truncate")).map((part) => part.firstElementChild);

      return { cutNames: names.filter((name) => name.scrollWidth > name.clientWidth).length, fewerDots: dots.some((row) => (row?.scrollHeight ?? 0) > (row?.clientHeight ?? 0)) };
    });
    expect(links).toEqual({ cutNames: 0, fewerDots: true });
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

    await page.getByRole("button", { name: "Sections", exact: true }).click();
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

    await panel(page).getByRole("button", { name: "Make live", exact: true }).first().click();
    await expect(lines(page).filter({ hasText: /is live now/ })).toBeVisible();
    await expect(lines(page)).toHaveCount(1);

    await toSection(page, "Sites");
    await reset(page);
    await lines(page).filter({ hasText: "Sample data reset." }).click();
    await expect(lines(page)).toHaveCount(0);
  });
});

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

    await fromRowMenu(page, SAMPLE.site, "New link");
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
  await panel(page).getByRole("button", { name: "Make live", exact: true }).first().click();
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
  await log.getByRole("button", { name: "Only this site", exact: true }).first().click();
  await expect(log.getByRole("button", { name: "Show every site", exact: true })).toBeFocused();

  // Reset leaves once the default is back.
  const perDay = page.getByRole("textbox", { name: "Requests per day", exact: true });
  await toSection(page, "Settings");
  await perDay.fill("1234");
  await page.locator("#setting-requests_per_day").getByRole("button", { name: "Reset", exact: true }).click();
  await expect(perDay).toBeFocused();
});

// Drift: a row reached by a key would show the pointer's tint alone again: a class that turns a row's outline off also turns off the one asked for with the focus, and a ring of the row's own lies under the cells that stay in place.
test("a site's row that takes the focus from a key draws a ring on all four sides, by its cells", async ({ page }) => {
  await arrive(page);
  const row = page.getByRole("table", { name: "Sites", exact: true }).locator("tbody > tr").first();
  // A key before the focus is what tells the engine to show it.
  await page.keyboard.press("Tab");
  await row.focus();

  const edges = await row.evaluate((focused) => [...focused.children].map((cell) => getComputedStyle(cell).boxShadow.split("inset").length - 1));
  expect({ first: edges.at(0), between: [...new Set(edges.slice(1, -1))], last: edges.at(-1) }).toEqual({ first: 3, between: [2], last: 3 });
});

// Drift: the filter at a row's end would search for a name again: the entries from before a new link or a rename would be gone, and those of another site of that name shown.
test("on Activity, Only this site keeps the entries of the row's site, the first one from before its new link among them, under a mark that names the site, and the mark's button shows every site again", async ({ page }) => {
  await arrive(page);
  await fromRowMenu(page, SAMPLE.site, "New link");
  await question(page, "Make a new link?").getByRole("button", { name: "Make a new link", exact: true }).click();
  await expect(said(page, "The site has a new link. The old link stopped working.")).toBeVisible();

  await toSection(page, "Activity");
  const log = rows(page, true, "Activity").locator("tbody");
  const mark = page.getByText(`Only ${SAMPLE.site}`, { exact: true });
  const ofSite = page.getByRole("link", { name: SAMPLE.site, exact: true });
  await log.getByRole("row").filter({ hasText: "Made a new link", has: ofSite }).getByRole("button", { name: "Only this site", exact: true }).click();
  await expect(mark).toBeVisible();
  await expect(log.getByRole("row").filter({ hasText: "Made the site" })).toHaveCount(1);
  await expect(log.getByRole("row").filter({ hasNot: ofSite })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Only this site", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Show every site", exact: true }).click();
  await expect(mark).toBeHidden();
  await expect(log.getByRole("row").filter({ hasNot: ofSite })).not.toHaveCount(0);
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
