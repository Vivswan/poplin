// The link walk: every place the dashboard's own controls lead to, on a wide screen and on a phone, in the light scheme and in the dark one. Nothing is changed: a question is opened and left.

import { expect, type Locator, type Page } from "@playwright/test";

import { arrive, screenHeading, siteLink, test } from "./visit";

/** The screens the walk is taken on. A wide one shows tables and the side navigation; a narrow one shows lists, and the sections behind a button. */
const VIEWPORTS = [
  { width: 1440, height: 900, wide: true },
  { width: 390, height: 844, wide: false },
] as const;

/** The schemes a browser asks for. The dashboard follows the browser until a theme is chosen in the account's menu. */
const SCHEMES = ["light", "dark"] as const;

/** What the sample data holds that the walk opens: an unlisted site, a person who is not the visitor, a token, and a login that waits. */
const SAMPLE = { site: "pricing", person: "jonas@example.com", token: "design-laptop", login: "build-server" } as const;

/** An email typed into the field that adds a person, and never sent. */
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
    shows: (page) => [screenHeading(page, "Sites"), siteLink(page, SAMPLE.site)],
  },
  {
    name: "Access, from the side",
    open: (page) => toSection(page, "Access"),
    shows: (page, wide) => [screenHeading(page, "Access"), rows(page, wide, "People"), rows(page, wide, "Computers and agents")],
  },
  {
    name: "Activity, from the side",
    open: (page) => toSection(page, "Activity"),
    shows: (page, wide) => [screenHeading(page, "Activity"), page.getByRole("tab", { name: "Activity", selected: true }), rows(page, wide, "Activity")],
  },
  {
    name: "Usage, the second tab of Activity",
    open: (page) => page.getByRole("tab", { name: "Usage", exact: true }).click(),
    shows: (page, wide) => [screenHeading(page, "Usage"), page.getByRole("tab", { name: "Usage", selected: true }), rows(page, wide, "Usage")],
  },
  {
    name: "Settings, from the side",
    open: (page) => toSection(page, "Settings"),
    shows: (page) => [
      screenHeading(page, "Settings"),
      page.getByRole("tab", { name: "Settings", selected: true }),
      page.getByRole("form", { name: "Sites", exact: true }),
    ],
  },
  {
    name: "the question before everyone is signed out",
    open: (page) => page.getByRole("button", { name: "Sign everyone out", exact: true }).click(),
    shows: (page) => [question(page, "Sign everyone out?")],
    close: leaveBy("Cancel"),
  },
  {
    name: "Domain, the second tab of Settings",
    open: (page) => page.getByRole("tab", { name: "Domain", exact: true }).click(),
    shows: (page) => [
      screenHeading(page, "Domain"),
      page.getByRole("tab", { name: "Domain", selected: true }),
      page.getByRole("heading", { name: "First, make a token", exact: true }),
    ],
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
    name: "Rename, from a row's menu",
    open: (page) => fromRowMenu(page, "Rename"),
    shows: (page) => [page.getByRole("dialog", { name: "Rename the site", exact: true }).getByRole("textbox", { name: "Name", exact: true })],
    close: cancelDialog,
  },
  {
    name: "New link, from a row's menu",
    open: (page) => fromRowMenu(page, "New link"),
    shows: (page) => [question(page, "Make a new link?")],
    close: leaveBy("Cancel"),
  },
  {
    name: "a site's panel",
    open: (page) => siteLink(page, SAMPLE.site).click(),
    shows: (page) => [
      panel(page).getByRole("heading", { name: SAMPLE.site, exact: true }),
      panel(page).getByRole("heading", { name: "Versions", exact: true }),
    ],
  },
  {
    name: "Rename, from the panel",
    open: (page) => panel(page).getByRole("button", { name: "Rename", exact: true }).click(),
    shows: (page) => [page.getByRole("dialog", { name: "Rename the site", exact: true }).getByRole("textbox", { name: "Name", exact: true })],
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
    shows: (page) => [screenHeading(page, "Sites"), siteLink(page, SAMPLE.site)],
  },
  {
    name: "the account's menu",
    open: (page) => page.getByRole("button", { name: /^Account/ }).click(),
    shows: (page) => [page.getByRole("menuitemradio", { name: "System", exact: true })],
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
    name: "the field that adds a person, with an email typed",
    open: async (page) => {
      await toSection(page, "Access");
      await page.getByRole("textbox", { name: "Email of the person to add", exact: true }).fill(TYPED_EMAIL);
    },
    shows: (page) => [page.getByRole("button", { name: "Add a person", exact: true, disabled: false })],
    close: (page) => page.getByRole("textbox", { name: "Email of the person to add", exact: true }).fill(""),
  },
  {
    name: "the question before a person is removed",
    open: (page) => page.getByRole("button", { name: `Remove ${SAMPLE.person}`, exact: true }).click(),
    shows: (page) => [question(page, `Remove ${SAMPLE.person}?`)],
    close: leaveBy("Keep"),
  },
  {
    name: "the question before a token is removed",
    open: (page) => page.getByRole("button", { name: `Remove ${SAMPLE.token}`, exact: true }).click(),
    shows: (page) => [question(page, `Remove ${SAMPLE.token}?`)],
    close: leaveBy("Keep"),
  },
  {
    name: "the review of a waiting login",
    open: (page) => page.getByRole("button", { name: `Review ${SAMPLE.login}`, exact: true }).click(),
    shows: (page) => [
      page
        .getByRole("dialog", { name: `Allow ${SAMPLE.login}?`, exact: true })
        .getByRole("checkbox", { name: "The code matches the one in my terminal", exact: true }),
    ],
    close: (page) =>
      page
        .getByRole("dialog", { name: `Allow ${SAMPLE.login}?`, exact: true })
        .getByRole("button", { name: "Close", exact: true })
        .click(),
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

/** Press one entry of a site's row menu. */
async function fromRowMenu(page: Page, entry: string): Promise<void> {
  await page.getByRole("button", { name: `More for ${SAMPLE.site}`, exact: true }).click();
  await page.getByRole("menuitem", { name: entry, exact: true }).click();
}

/** The panel of the sample site: beside the table on a wide screen, over the list on a narrow one. */
function panel(page: Page): Locator {
  return page.getByRole("dialog", { name: SAMPLE.site, exact: true });
}

/** A question that asks before a change. */
function question(page: Page, title: string | RegExp): Locator {
  return page.getByRole("alertdialog", { name: title, exact: true });
}

/** Leave a question by the button that does not do the change. */
function leaveBy(label: string): (page: Page) => Promise<void> {
  return (page) => page.getByRole("alertdialog").getByRole("button", { name: label, exact: true }).click();
}

/** Leave a dialog with a field by its Cancel. */
async function cancelDialog(page: Page): Promise<void> {
  await page.getByRole("dialog", { name: "Rename the site", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
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

      test("every section, tab, panel, menu, and question opens and closes, with nothing refused, blocked, thrown, or asked elsewhere", async ({
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
