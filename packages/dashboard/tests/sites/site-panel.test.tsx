// The panel of one site: what stands under the switch for search engines while the switch changes nothing, and under the one for embedding, who can open it, how its visits are worded,
// its three folds, and the files of its live version.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { SiteActions } from "@/sites/site-actions";
import { SitePanel } from "@/sites/site-panel";

import { openFold } from "../lib/support/fold";
import { drawAt } from "../lib/support/router";

/** The runtime's own `fetch`, put back after each test. */
const OWN_FETCH = globalThis.fetch;

/** The line under the switch for embedding, which every site's panel carries. */
const EMBEDDING = "Other pages may show this site in a frame and load its files.";

/** What the server answers while it reads no site: the day's requests are used up. */
const BUSY = { ok: false, code: "allowance_spent", about: "requests_per_day", sentence: "The install takes no more requests today." };

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

/** Draw the panel of a site that anyone, or only its owner, can open, on an install that lets search engines in or keeps them out, with the visits the site counted, and open its Details. */
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
  await openFold("Details");
  await within(document.body).findByText("Show in search engines");
}

/** What each row of the tree of a site's files says, from the top down. */
function rows(): readonly string[] {
  return [...document.querySelectorAll("[role='tree'] [data-slot='tree-label']")].map((row) => row.textContent ?? "");
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
    await within(document.body).findByText("New link");
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

describe("the folds of a site's panel", () => {
  /** The folds, by their headings. */
  const FOLDS = ["Files", "Versions", "Details"] as const;

  /** The top of a site's files as the server answers it: one file. */
  const TOP = { ok: true, folders: [], files: [{ path: "index.html", size: 7 }], next: null, total: 1 };

  /** A second site, with two versions, the newer one live. */
  const OTHER = {
    ...SITE,
    id: "xyz789uvw012",
    label: "road-map--xyz789uvw012",
    name: "road-map",
    title: "Road map",
    versions: [...SITE.versions, { number: 2, published: 1_700_086_400_000, published_by: "mira@example.com" }],
    live_version: 2,
  };

  /** What a server answers of a site at the time: the site, a refusal in its place while `refused` holds, and neither before `until` is settled. */
  interface Served {
    site: typeof SITE;
    refused?: boolean;
    until?: Promise<void>;
  }

  /** A place that keeps a reading of a site for half a minute, as the dashboard's own does: a panel drawn inside that time finds the site kept, and still fresh. */
  function keeping(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  }

  /**
   * Draw the panel of a site over a server that answers of the site what `served` holds at the time, and holds back the top of its files until it is told to answer.
   *
   * @param actions - the changes of a site that a test presses; left out, the panel has none
   * @param client - what the panel keeps of the server's answers; left out, it keeps nothing from before
   * @returns `asked`, the version of each request for the files, `listed`, how many there were, and `answer`, which waits for such a request, answers every one that waits, and waits for the rows of the tree
   */
  async function drawn(
    served: Served,
    { actions = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false } } }) }: { readonly actions?: Partial<SiteActions>; readonly client?: QueryClient } = {},
  ): Promise<{ readonly client: QueryClient; readonly asked: readonly string[]; readonly listed: () => number; readonly answer: () => Promise<void> }> {
    const waiting: ReturnType<typeof Promise.withResolvers<void>>[] = [];
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const { pathname, searchParams } = new URL(String(input), "https://dashboard.example.com");
      if (!pathname.endsWith("/files")) {
        await served.until;

        return served.refused === true ? Response.json(BUSY, { status: 429 }) : Response.json({ ok: true, site: served.site, logins: {}, search_engines_allowed: true });
      }

      asked.push(searchParams.get("version") ?? "");
      const held = Promise.withResolvers<void>();
      waiting.push(held);
      await held.promise;

      return Response.json(TOP);
    }) as unknown as typeof fetch;
    await drawAt(
      "/",
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SitePanel
            label={served.site.label}
            actions={actions as SiteActions}
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
    await within(document.body).findByRole("button", { name: "Details" });

    const answer = async (): Promise<void> => {
      await waitFor(() => expect(waiting.length > 0).toBe(true));
      await act(async () => {
        for (const held of waiting.splice(0)) held.resolve();
      });
      await waitFor(() => expect(rows().length).toBe(1));
    };

    return { client, asked, listed: () => asked.length, answer };
  }

  /** The folds whose heading is a button that tells a screen reader it is open, and the ones whose button says it is folded. A fold with no such button is in neither. */
  function folds(): { readonly open: readonly string[]; readonly folded: readonly string[] } {
    const saying = (expanded: boolean): readonly string[] => FOLDS.filter((name) => within(document.body).queryByRole("button", { name: new RegExp(`^${name}`), expanded }) !== null);

    return { open: saying(true), folded: saying(false) };
  }

  /** What of the folds the panel shows, as a screen reader finds it: the names of the facts, how many versions are listed, how many switches there are, and the rows of the files. What a fold holds while it is folded is on the page, hidden. */
  function held(): object {
    const panel = within(within(document.body).getByRole("complementary"));

    return {
      facts: panel.queryAllByRole("term").map((name) => name.textContent ?? ""),
      versions: panel.queryAllByRole("listitem").length,
      switches: panel.queryAllByRole("switch").length,
      files: rows(),
    };
  }

  // Drift: the files, the versions, and the facts would stand open again over a panel as long as it was; a fold's heading would be words that no key opens and no screen reader calls folded;
  // or a look at the versions or the facts would list the storage, which the install counts against its day.
  test("start folded, each under a button that says so, with nothing of them in sight; Versions and Details, once pressed, are in sight and read no files", async () => {
    const { listed } = await drawn({ site: OTHER });
    const before = [folds(), held(), listed()];
    await openFold("Versions");
    await openFold("Details");

    expect(before).toEqual([{ open: [], folded: [...FOLDS] }, { facts: [], versions: 0, switches: 0, files: [] }, 0]);
    expect([folds(), held(), listed()]).toEqual([
      { open: ["Versions", "Details"], folded: ["Files"] },
      { facts: ["Visits", "Size", "Updated", "Expires"], versions: 2, switches: 2, files: [] },
      0,
    ]);
  });

  // Drift: the panel would forget which folds a person left open, so the next site's panel would start folded again; or Files, left open, would stay grey lines that read nothing.
  test("are as a person left them in the panel of the next site: the open ones are drawn open, the one closed again stays folded, and Files left open reads its top once as the panel is drawn", async () => {
    const first = await drawn({ site: SITE });
    for (const name of FOLDS) await openFold(name);
    await first.answer();
    fireEvent.click(await openFold("Versions"));
    cleanup();

    const next = await drawn({ site: OTHER });
    await next.answer();

    expect([folds(), held(), next.listed()]).toEqual([
      { open: ["Files", "Details"], folded: ["Versions"] },
      { facts: ["Visits", "Size", "Updated", "Expires"], versions: 0, switches: 2, files: ["index.html7 B"] },
      1,
    ]);
  });

  // Drift: the site is read again after every change, as after Make live, and a fold would close over the control that was pressed, or be drawn anew and drop the focus its heading holds;
  // or the files of the version that was live would stay under the heading, with their count, while the files of the one that is live are read.
  test("stay open, with the focus on a heading left there, when the site is read again with another version live; Files then shows neither the rows nor the count of the version that was live while it reads the one that is", async () => {
    const served = { site: OTHER };
    const { client, listed, answer } = await drawn(served);
    const heading = (): HTMLElement => within(document.body).getByRole("button", { name: /^Files/ });
    const files = (): readonly unknown[] => [heading().textContent, rows()];
    for (const name of FOLDS) await openFold(name);
    await answer();
    const read = files();
    act(() => heading().focus());

    served.site = { ...OTHER, live_version: 1, embeddable: true };
    await act(async () => client.invalidateQueries());
    await waitFor(() => expect(listed()).toBe(2));
    const reading = [folds(), files(), document.activeElement === heading()];
    await answer();

    expect([read, reading, files()]).toEqual([["Files1", ["index.html7 B"]], [{ open: [...FOLDS], folded: [] }, ["Files", []], true], ["Files1", ["index.html7 B"]]]);
    expect(within(document.body).getByRole("switch", { name: "Allow embedding" }).getAttribute("aria-checked")).toBe("true");
  });

  // Drift: a panel drawn from a site that is kept from before, with Files left open, would list the files of a version that is live no more: a listing of the storage for nothing.
  // A panel drawn inside the time a reading stands would not ask the server at all, and take the kept site at its word.
  test("left open, Files waits for the server's word on the site: a panel drawn from a kept one that still stands, whose live version has changed since, lists the live version alone", async () => {
    const client = keeping();
    const served: Served = { site: { ...OTHER, live_version: 1 } };
    await drawn(served, { client });
    cleanup();
    const other = await drawn({ site: SITE }, { client });
    await openFold("Files");
    await other.answer();
    cleanup();

    served.site = OTHER;
    const again = await drawn(served, { client });
    await again.answer();

    expect([again.asked, folds().open]).toEqual([["2"], ["Files"]]);
  });

  // Drift: the rows kept of a version that was live would stand under a panel drawn from a kept site, over links that serve another version by now;
  // or a site the server would not read again would be taken at its word, and its files listed.
  test("left open, Files shows no kept row and lists nothing until the server has said which version is live: grey lines while the site is read, the refusal's sentence where it is refused, the live version's files once it is answered", async () => {
    const client = keeping();
    const served: Served = { site: { ...OTHER, live_version: 1 } };
    const first = await drawn(served, { client });
    await openFold("Files");
    await first.answer();
    cleanup();
    const files = (): readonly unknown[] => [within(document.body).getByRole("button", { name: /^Files/ }).textContent, rows()];

    const read = Promise.withResolvers<void>();
    Object.assign(served, { site: OTHER, refused: true, until: read.promise });
    const again = await drawn(served, { client });
    const reading = [files(), document.querySelectorAll("[aria-busy='true']").length, again.listed()];
    await act(async () => read.resolve());
    await within(document.body).findByText(BUSY.sentence);
    const refused = [files(), document.querySelectorAll("[aria-busy='true']").length, again.listed()];

    served.refused = false;
    await act(async () => client.invalidateQueries());
    await again.answer();

    expect([reading, refused]).toEqual([[["Files", []], 1, 0], [["Files", []], 0, 0]]);
    expect([files(), again.asked, within(document.body).queryByText(BUSY.sentence)]).toEqual([["Files1", ["index.html7 B"]], ["2"], null]);
  });

  // Drift: Files opened while the site is read again, as after Make live, would list the version that was live, and then the one that is: two listings of the storage for one tree;
  // or it would show the rows kept of the version that was live, over links that serve the other by then.
  test.each([
    ["never read", false, [], ["1"]],
    ["read before, and kept", true, ["2"], ["2", "1"]],
  ])("opened while the site is read again, Files shows no row and lists nothing until the server answers, and then lists the version that is live: the files of the one that was live were %s", async (_what, kept, before, listed) => {
    const served: Served = { site: OTHER };
    const { client, asked, answer } = await drawn(served);
    if (kept) {
      const heading = await openFold("Files");
      await answer();
      fireEvent.click(heading);
    }

    const read = Promise.withResolvers<void>();
    Object.assign(served, { site: { ...OTHER, live_version: 1 }, until: read.promise });
    act(() => void client.invalidateQueries());
    await openFold("Files");
    const meanwhile = [rows(), [...asked]];
    await act(async () => read.resolve());
    await answer();

    expect([meanwhile, asked]).toEqual([[[], before], listed]);
  });

  // Drift: a fold that drew what it holds anew at every opening would lose what a control in it has yet to say: a switch that is being saved would show what is stored again, and take a second press.
  test("keep what they hold while they are folded: a switch that is being saved is as it was pressed when Details is opened again, and takes no second press", async () => {
    const saved = Promise.withResolvers<typeof SITE>();
    const sent: boolean[] = [];
    const setSetting = (_site: unknown, _setting: string, on: boolean): Promise<typeof SITE> => {
      sent.push(on);

      return saved.promise;
    };
    await drawn({ site: SITE }, { actions: { setSetting } as unknown as Partial<SiteActions> });
    const details = await openFold("Details");
    const embedding = (): HTMLElement => within(document.body).getByRole("switch", { name: "Allow embedding" });

    fireEvent.click(embedding());
    fireEvent.click(details);
    const folded = within(document.body).queryByRole("switch", { name: "Allow embedding" });
    fireEvent.click(details);
    fireEvent.click(embedding());
    const pressed = embedding().getAttribute("aria-checked");
    await act(async () => saved.resolve({ ...SITE, embeddable: true }));

    expect([sent, folded, pressed]).toEqual([[true], null, "true"]);
  });

  // Drift: a site in the trash would show its facts unfolded, or the files and the versions of a site that is served to nobody, or the settings it cannot be given there.
  test("of a site in the trash are Details alone: its facts without the day it expires, and no setting", async () => {
    await drawn({ site: { ...SITE, state: "trash" } });
    const before = [folds(), held()];
    await openFold("Details");

    expect(before).toEqual([{ open: [], folded: ["Details"] }, { facts: [], versions: 0, switches: 0, files: [] }]);
    expect([folds(), held()]).toEqual([{ open: ["Details"], folded: [] }, { facts: ["Visits", "Size", "Updated"], versions: 0, switches: 0, files: [] }]);
  });

  // Drift: a block that held its own fold would take what the browser keeps by then where its panel draws it anew, as it does Details when a site comes back from the trash:
  // another tab's fold would close it without a press.
  test("stay as they are in a panel whose site comes back from the trash, whatever the browser keeps by then", async () => {
    const served: Served = { site: { ...SITE, state: "trash" } };
    const { client } = await drawn(served);
    await openFold("Details");
    window.localStorage.clear();

    served.site = SITE;
    await act(async () => client.invalidateQueries());
    await within(document.body).findByRole("button", { name: "New link" });

    expect(folds()).toEqual({ open: ["Details"], folded: ["Files", "Versions"] });
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
   * @returns `asked`, the queries the folders were asked with, in the order they came, and `live`, the version the server says is live, and whether it refuses to read the site
   */
  async function drawn(
    answer: (query: string) => Answer | undefined,
  ): Promise<{ readonly client: QueryClient; readonly asked: string[]; readonly live: { version: number; refused: boolean } }> {
    const asked: string[] = [];
    const live = { version: 1, refused: false };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const { pathname, searchParams } = new URL(String(input), "https://dashboard.example.com");
      if (!pathname.endsWith("/files")) {
        const site = { ...SITE, live_version: live.version, versions: kept(live.version) };

        return live.refused ? Response.json(BUSY, { status: 429 }) : Response.json({ ok: true, site, logins: {}, search_engines_allowed: true });
      }

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
    await within(document.body).findByText("New link");

    return { client, asked, live };
  }

  /** The button that folds the files away and opens them. */
  function fold(): HTMLElement {
    return within(document.body).getByRole("button", { name: /^Files/ });
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

    // Folded and opened again, the tree is as it was. A folder that was read is not read again, also when the new tree is told to open it.
    press("constructor/");
    fireEvent.click(fold());
    fireEvent.click(fold());
    await waitFor(() => expect(rows().length).toBe(8));
    press("constructor/");
    await waitFor(() => expect(rows().length).toBe(9));
    const reopened = asked.length;

    // Another version live is another tree: Files stays open as it was left, with no folder open, and its top is read anew.
    live.version = 2;
    await act(async () => client.invalidateQueries());
    await waitFor(() => expect(rows().join()).toBe("index.html7 B,only.html8 B"));

    expect([reopened, asked.slice(reopened), fold().textContent, fold().getAttribute("aria-expanded")]).toEqual([4, ["version=2"], "Files2", "true"]);
  });

  // Drift: a reading of the site that was refused would take the tree away with the folders that were open in it, and the next answered one would bring it back with every folder closed.
  test("are as they were once the site is read again after a refusal: the refusal stands where the tree was, and the tree comes back with its open folder and reads nothing anew", async () => {
    const { client, asked, live } = await drawn((query) => NESTED[query]);
    fireEvent.click(fold());
    await waitFor(() => expect(rows().length).toBe(4));
    press("assets/");
    await waitFor(() => expect(rows().length).toBe(6));
    const open = rows();

    live.refused = true;
    await act(async () => client.invalidateQueries());
    await within(document.body).findByText(BUSY.sentence);
    const refused = rows();
    live.refused = false;
    await act(async () => client.invalidateQueries());
    await waitFor(() => expect(rows().length > 0).toBe(true));

    expect([refused, rows(), asked]).toEqual([[], open, ["version=1", "folder=assets&version=1"]]);
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
