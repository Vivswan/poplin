// The Site cell of the Activity table: what an entry's site is called, and what a pointer resting on it reads.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, within } from "@testing-library/react";

import { SiteThen } from "@/activity/activity-columns";
import type { Entry } from "@/activity/activity-queries";

import { drawAt } from "../lib/support/router";

/** An entry about a site, as the server answers it. */
function entryAbout(site: Entry["site"]): Entry {
  return { seq: 7, at: 1_700_000_000_000, by: "mira@example.com", action: "details", detail: {}, site } as Entry;
}

afterEach(cleanup);
afterAll(clearPage);

// Drift: the log would call a site by its name where the Sites list calls it by its title, so one site would read as two; or the name it had then, which the search and the file go by, would be nowhere on the row.
test.each([
  ["a site with a title", { name: "trip-notes", label: "trip-notes-abc123def456", title: "Trip notes" }, ["Trip notes", "trip-notes", true]],
  ["a site with no title", { name: "trip-notes", label: "trip-notes-abc123def456", title: null }, ["trip-notes", "trip-notes", true]],
  ["a site that is gone", { name: "old-draft", label: null, title: null }, ["old-draft", "This site is gone", false]],
] as const)("%s is called by its title, else by the name it had then, which stays in the tooltip of a site that is one", async (_what, site, [words, tooltip, linked]) => {
  await drawAt("/activity", <SiteThen entry={entryAbout(site)} />);
  const cell = within(document.body).getByText(words);

  expect([cell.getAttribute("title"), cell.tagName === "A"]).toEqual([tooltip, linked]);
});
