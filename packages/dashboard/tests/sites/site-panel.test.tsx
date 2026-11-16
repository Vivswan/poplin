// The panel of one site: what stands under the switch for search engines while the switch changes nothing, and under the one for embedding.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, within } from "@testing-library/react";

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

/** Draw the panel of a site that anyone, or only its owner, can open, on an install that lets search engines in or keeps them out. */
async function draw(access: string, allowed: boolean): Promise<void> {
  globalThis.fetch = (async () => Response.json({ ok: true, site: { ...SITE, access }, logins: {}, search_engines_allowed: allowed })) as unknown as typeof fetch;
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

/** The lines under the two switches, as they are read, in the panel's order. No other line of this kind is in the panel. */
function notes(): readonly string[] {
  return [...document.querySelectorAll("[data-slot='field-description']")].map((line) => line.textContent ?? "");
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
