// The panel of one site: what stands under the switch for search engines while the switch changes nothing, and under the one for embedding, who can open it, and how its visits are worded.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { SiteActions } from "@/sites/site-actions";
import { SitePanel } from "@/sites/site-panel";

import { drawAt } from "../lib/support/router";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The line under the switch for embedding, which every site's panel carries. */
const EMBEDDING = "Other pages may show this site in a frame and load its files.";

/** A site as the server answers it. */
const SITE = {
  id: "abc123def456",
  label: "trip-notes--abc123def456",
  name: "trip-notes",
  public_name: null,
  title: "Trip notes",
  title_typed: true,
  access: "private",
  url: "https://example.com/trip-notes/",
  addresses: { site: "https://example.com/trip-notes/", public: null },
  search_engines: true,
  embeddable: false,
  expires: "never",
  versions: [{ number: 1, published: 1_700_000_000_000, published_by: "mira@example.com" }],
  live_version: 1,
  bytes: 2048,
  files: 3,
  updated: 1_700_000_000_000,
  state: "live",
  views: { today: 0, week: 0 },
};

/** Draw the panel of a site that anyone, or only its owner, can open, on an install that lets search engines in or keeps them out, with the visits the site counted. */
async function draw(access: string, allowed: boolean, views: typeof SITE.views = SITE.views): Promise<void> {
  globalThis.fetch = (async () => Response.json({ ok: true, site: { ...SITE, access, views }, logins: {}, search_engines_allowed: allowed })) as unknown as typeof fetch;
  await drawAt(
    "/",
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <SitePanel
          label={SITE.label}
          actions={{} as SiteActions}
          reveal={{ shows: () => false, toggle: () => undefined }}
          onAsk={() => undefined}
          closeLink={<a href="/">Close</a>}
          onClose={() => undefined}
          opener={() => undefined}
          onMoved={() => undefined}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await within(document.body).findByText("Show in search engines");
}

/** The line each of the two switches is described by, as a screen reader says it after the switch's name, in the panel's order. */
function notes(): readonly string[] {
  const switches = [...document.querySelectorAll("[role='switch']")];

  return switches.flatMap((one) => (one.getAttribute("aria-describedby")?.split(" ") ?? []).map((id) => document.getElementById(id)?.textContent ?? ""));
}

afterEach(() => {
  cleanup();
  globalThis.fetch = OWN_FETCH;
});
afterAll(clearPage);

describe("the two switches in a site's panel", () => {
  // Drift: the switch for embedding would name frames alone, as its label does, and a person would leave it on for a site whose files no other site should load.
  // Drift: a private site on an install that keeps search engines out would say only that it is not public, so making it public would look like the way to be listed; or a switch that works would carry a line.
  test.each([
    ["a public site on an install that lets search engines in", "public", true, []],
    ["a private site on such an install", "private", true, ["Only a public site is listed."]],
    ["a public site on an install that keeps them out", "public", false, ["Off for every site in Settings."]],
    ["a private site on such an install", "private", false, ["Off for every site in Settings."]],
  ])("say what keeps the first from working, the install's reason alone where two hold, and both things the second decides: %s", async (_what, access, allowed, said) => {
    await draw(access, allowed);

    expect(notes()).toEqual([...said, EMBEDDING]);
  });
});

describe("the choice of who can open a site", () => {
  // Drift: the three buttons would stand in a group with no name again, and the sentence that says what the chosen one means would be tied to nothing.
  test.each([
    ["private", "Only users who can log in here."],
    ["public", "Everyone, at a public link."],
  ])("is a group named by its heading and described by what the chosen one means: %s", async (access, means) => {
    await draw(access, true);

    expect(within(document.body).getAllByRole("group", { name: "Who can open it", description: means }).length).toBe(1);
  });
});

describe("the visits of a site", () => {
  // Drift: a site nobody opened would say "about 0" again, which reads as a slip; or a count above none would lose its "about" and read as exact.
  test.each([
    [{ today: 0, week: 0 }, "0 today, 0 in 7 days"],
    [{ today: 0, week: 14 }, "0 today, about 14 in 7 days"],
    [{ today: 3, week: 1200 }, "about 3 today, about 1,200 in 7 days"],
  ])("say about before every count but none: %o", async (views, said) => {
    await draw("private", true, views);

    expect(within(document.body).getByText("Visits").nextElementSibling?.textContent).toBe(said);
  });
});

describe("a panel whose site is no longer there", () => {
  /** What the server answers for a label no site has. */
  const GONE = { ok: false, code: "not_found", about: null, sentence: "No site is at this address. It may have been deleted, or the link is an old one." };

  /** Draw the panel over a server that answers the site while `there` holds, and count how often the panel asks to be closed. */
  async function drawn(there: { on: boolean }): Promise<{ readonly client: QueryClient; readonly closed: () => number }> {
    let closed = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = (async () =>
      there.on ? Response.json({ ok: true, site: SITE, logins: {}, search_engines_allowed: true }) : Response.json(GONE, { status: 404 })) as unknown as typeof fetch;
    await drawAt(
      "/",
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SitePanel
            label={SITE.label}
            actions={{} as SiteActions}
            reveal={{ shows: () => false, toggle: () => undefined }}
            onAsk={() => undefined}
            closeLink={<a href="/">Close</a>}
            onClose={() => {
              closed += 1;
            }}
            opener={() => undefined}
            onMoved={() => undefined}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    return { client, closed: () => closed };
  }

  // Drift: a site deleted for good while its panel is open, here or in another tab, would leave a panel headed "Site" that says no site is at this address, over a list the site has left.
  test("closes once the site it showed is gone, and an address that never named a site keeps its sentence", async () => {
    const there = { on: true };
    const shown = await drawn(there);
    await within(document.body).findByText("Show in search engines");
    there.on = false;
    // The site's read is made again and refused, with the site it read before still held, as after a delete in another tab.
    await act(async () => shown.client.invalidateQueries());
    await waitFor(() => expect(shown.closed() > 0).toBe(true));
    cleanup();

    const never = await drawn(there);
    await within(document.body).findByText(GONE.sentence);

    expect(never.closed()).toBe(0);
  });
});

describe("the files of a site", () => {
  /** One folder as the server answers it. */
  interface Answer {
    readonly folders: readonly string[];
    readonly files: readonly { readonly path: string; readonly size: number }[];
    readonly next: string | null;
    readonly total: number;
  }

  /** The versions a site keeps up to its live one, each published a day after the one before. */
  function kept(live: number): readonly object[] {
    return Array.from({ length: live }, (_unused, before) => ({ number: before + 1, published: 1_700_000_000_000 + before * 86_400_000, published_by: "mira@example.com" }));
  }

  /** What the server answers when the day's listings of the storage are used up. */
  const SPENT = { ok: false, code: "allowance_spent", about: "max_storage_writes_per_day", sentence: "The storage takes no more writes today." };

  /**
   * The top of a site of six files, the folders in it, and the folder in one of them; and the two files of its second version.
   *
   * One folder has the name of a part every object has: a tree that looked its folders up in a plain object would take that part for a folder already read.
   */
  const NESTED: Readonly<Record<string, Answer>> = {
    "version=1": { folders: ["assets", "constructor"], files: [{ path: "index.html", size: 12_400 }, { path: "notes & more.txt", size: 5 }], next: null, total: 6 },
    "folder=assets&version=1": { folders: ["assets/img"], files: [{ path: "assets/app.css", size: 3100 }], next: null, total: 6 },
    "folder=assets/img&version=1": { folders: [], files: [{ path: "assets/img/logo.svg", size: 900 }, { path: "assets/img/photo.jpg", size: 230_000 }], next: null, total: 6 },
    "folder=constructor&version=1": { folders: [], files: [{ path: "constructor/index.html", size: 1 }], next: null, total: 6 },
    "version=2": { folders: [], files: [{ path: "index.html", size: 7 }, { path: "only.html", size: 8 }], next: null, total: 2 },
  };

  /**
   * Draw the panel over a server that answers the site, and each folder of its files by the query it is asked with: a folder, or `undefined` for the refusal that the day's listings are used up.
   *
   * @returns `asked`, the queries the folders were asked with, in the order they came, and `live`, the version the server says is live
   */
  async function drawn(answer: (query: string) => Answer | undefined): Promise<{ readonly client: QueryClient; readonly asked: string[]; readonly live: { version: number } }> {
    const asked: string[] = [];
    const live = { version: 1 };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const { pathname, searchParams } = new URL(String(input), "https://dashboard.example.com");
      if (!pathname.endsWith("/files")) return Response.json({ ok: true, site: { ...SITE, live_version: live.version, versions: kept(live.version) }, logins: {}, search_engines_allowed: true });

      // The keys are put in one order: the order an address has them in is nothing the server reads.
      const query = [...searchParams].map(([key, value]) => `${key}=${value}`).sort().join("&");
      asked.push(query);
      const folder = answer(query);

      return folder === undefined ? Response.json(SPENT, { status: 503 }) : Response.json({ ok: true, ...folder });
    }) as unknown as typeof fetch;
    await drawAt(
      "/",
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SitePanel
            label={SITE.label}
            actions={{} as SiteActions}
            reveal={{ shows: () => false, toggle: () => undefined }}
            onAsk={() => undefined}
            closeLink={<a href="/">Close</a>}
            onClose={() => undefined}
            opener={() => undefined}
            onMoved={() => undefined}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await within(document.body).findByText("Show in search engines");

    return { client, asked, live };
  }

  /** The button that folds the files away and opens them. */
  function fold(): HTMLElement {
    return within(document.body).getByRole("button", { name: /^Files/ });
  }

  /** What each row of the tree says, from the top down. */
  function rows(): readonly string[] {
    return [...document.querySelectorAll("[role='tree'] [data-slot='tree-label']")].map((row) => row.textContent ?? "");
  }

  /** A row of the tree, by what it says. */
  function row(says: string): HTMLElement {
    const found = [...document.querySelectorAll<HTMLElement>("[role='tree'] [data-slot='tree-label']")].find((one) => one.textContent === says);
    if (found === undefined) throw new Error(`the tree has no row that says ${says}`);

    return found;
  }

  /** Press a row of the tree, by what it says. */
  function press(says: string): void {
    fireEvent.click(row(says));
  }

  /** Give a row of the tree the focus, and press Enter on it. */
  function enter(says: string): void {
    const item = row(says).closest<HTMLElement>("[role='treeitem']");
    item?.focus();
    fireEvent.keyDown(item ?? document.body, { key: "Enter" });
  }

  /** What the row that holds the focus says; empty where no row holds it. */
  function focused(): string {
    return document.activeElement?.querySelector(":scope > [data-slot='tree-label']")?.textContent ?? "";
  }

  // Drift: a panel that is only looked at would list the storage, which the install counts against its day; a folder would be read before it is opened, or with what lies in its folders;
  // a file's row would lead to another file, or to an address a `&` or a space in its name cuts short; or the tree of a version that is live no more would stay under the panel.
  test("are read a folder at a time, as each is opened: nothing while they are folded, the top at the first opening, and a folder at its own, with its folders before its files and each file a link to itself in a new tab", async () => {
    const { client, asked, live } = await drawn((query) => NESTED[query]);
    const before = [asked.length, fold().textContent, rows()];

    fireEvent.click(fold());
    await waitFor(() => expect(rows().length).toBe(4));
    const top = [[...asked], fold().textContent, rows()];
    press("assets/");
    await waitFor(() => expect(rows().length).toBe(6));
    press("img/");
    await waitFor(() => expect(rows().length).toBe(8));
    press("constructor/");
    await waitFor(() => expect(rows().length).toBe(9));
    const links = within(document.body)
      .getAllByRole("link")
      .filter((link) => link.closest("[role='tree']") !== null)
      .map((link) => [link.getAttribute("href"), link.getAttribute("target")]);

    expect([before, top]).toEqual([
      [0, "Files", []],
      [["version=1"], "Files6", ["assets/", "constructor/", "index.html12.4 kB", "notes & more.txt5 B"]],
    ]);
    expect([asked, rows()]).toEqual([
      ["version=1", "folder=assets&version=1", "folder=assets/img&version=1", "folder=constructor&version=1"],
      ["assets/", "img/", "logo.svg900 B", "photo.jpg230 kB", "app.css3.1 kB", "constructor/", "index.html1 B", "index.html12.4 kB", "notes & more.txt5 B"],
    ]);
    expect(links).toEqual([
      ["https://example.com/trip-notes/assets/img/logo.svg", "_blank"],
      ["https://example.com/trip-notes/assets/img/photo.jpg", "_blank"],
      ["https://example.com/trip-notes/assets/app.css", "_blank"],
      ["https://example.com/trip-notes/constructor/index.html", "_blank"],
      ["https://example.com/trip-notes/index.html", "_blank"],
      ["https://example.com/trip-notes/notes%20%26%20more.txt", "_blank"],
    ]);

    // Folded and opened again, the tree is as it was. A folder that was read is not read again, also when the new tree is told to open it. Another version live is another tree: folded, and read anew when it is opened.
    press("constructor/");
    fireEvent.click(fold());
    fireEvent.click(fold());
    await waitFor(() => expect(rows().length).toBe(8));
    press("constructor/");
    await waitFor(() => expect(rows().length).toBe(9));
    const reopened = asked.length;
    live.version = 2;
    await act(async () => client.invalidateQueries());
    await waitFor(() => expect(fold().textContent).toBe("Files"));
    fireEvent.click(fold());
    await waitFor(() => expect(rows().join()).toBe("index.html7 B,only.html8 B"));

    expect([reopened, asked.slice(reopened), fold().textContent]).toEqual([4, ["version=2"], "Files2"]);
  });

  // Drift: a folder of more files than one page holds would end where the page does, with no word that more are there; a second press while the next page is on its way would ask for that page twice;
  // or the focus of a row that left would go to the top of the tree, away from the rows it brought.
  test("of a folder that holds more than a page end in Show more, at the top and in a folder alike, which reads on once however often it is pressed, and leaves the focus on the row above the new ones", async () => {
    const pages: Readonly<Record<string, Answer>> = {
      "version=1": { folders: ["docs"], files: [{ path: "a.txt", size: 1 }], next: "after-a", total: 5 },
      "cursor=after-a&version=1": { folders: ["more"], files: [{ path: "index.html", size: 2 }], next: null, total: 5 },
      "folder=docs&version=1": { folders: [], files: [{ path: "docs/c.txt", size: 3 }], next: "after-c", total: 5 },
      "cursor=after-c&folder=docs&version=1": { folders: [], files: [{ path: "docs/d.txt", size: 4 }], next: null, total: 5 },
    };
    const { asked } = await drawn((query) => pages[query]);

    fireEvent.click(fold());
    await waitFor(() => expect(rows().length).toBe(3));
    const first = rows();
    enter("Show more");
    await waitFor(() => expect(rows().includes("Show more")).toBe(false));
    const whole = [rows(), focused()];
    press("docs/");
    await waitFor(() => expect(rows().includes("Show more")).toBe(true));
    press("Show more");
    press("Show more");
    await waitFor(() => expect(rows().includes("Show more")).toBe(false));

    expect([first, whole, rows()]).toEqual([
      ["docs/", "a.txt1 B", "Show more"],
      [["docs/", "more/", "a.txt1 B", "index.html2 B"], "a.txt1 B"],
      ["docs/", "c.txt3 B", "d.txt4 B", "more/", "a.txt1 B", "index.html2 B"],
    ]);
    expect(asked).toEqual(["version=1", "cursor=after-a&version=1", "folder=docs&version=1", "cursor=after-c&folder=docs&version=1"]);
  });

  // Drift: a read the server refuses would leave grey lines that never end, or a folder that opens on nothing; and a day whose listings are used up would be told as a broken page.
  test("that cannot be read say the server's sentence, where the tree would be and under the folder that stays closed; the next opening reads again", async () => {
    const refused = new Set(["version=1", "folder=assets&version=1"]);
    const { asked } = await drawn((query) => (refused.has(query) ? undefined : NESTED[query]));

    fireEvent.click(fold());
    await within(document.body).findByText(SPENT.sentence);
    const unread = rows();
    refused.delete("version=1");
    fireEvent.click(fold());
    fireEvent.click(fold());
    await waitFor(() => expect(rows().length).toBe(4));
    const read = within(document.body).queryByText(SPENT.sentence);

    press("assets/");
    await within(document.body).findByText(SPENT.sentence);
    const shut = rows();
    refused.clear();
    press("assets/");
    await waitFor(() => expect(rows().length).toBe(6));

    expect([unread, read, shut.length, within(document.body).queryByText(SPENT.sentence)]).toEqual([[], null, 4, null]);
    expect(asked).toEqual(["version=1", "version=1", "folder=assets&version=1", "folder=assets&version=1"]);
  });
});
