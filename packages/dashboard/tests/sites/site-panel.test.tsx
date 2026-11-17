// The panel of one site: what stands under the switch for search engines while the switch changes nothing, and under the one for embedding, who can open it, and how its visits are worded.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, waitFor, within } from "@testing-library/react";

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
