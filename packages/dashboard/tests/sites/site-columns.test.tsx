// A site's link as text: the places a shown link offers to go on in the next line. Where a browser then breaks it is its layout's, which this page does not have.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";

import type { Site } from "@/lib/sites";
import { SiteLink } from "@/sites/site-columns";

/** A site whose link holds its name, its id, and a word after it. */
const SITE = { id: "abc123def456", url: "https://sales-report--abc123def456-p-poplin.example.com/" } as Pick<Site, "id" | "url">;

afterEach(cleanup);
afterAll(clearPage);

// Drift: a place to break would go missing after a dash, so a long link would have to break inside a word; or one would be offered between the two dashes before the id; or the text a selection copies would change.
// Or one would be offered after the lone letter near the end, which leaves "-p-" at a line's end and the last word alone under it.
test("a shown link that wraps offers a break after each run of dashes but not after a lone letter between dashes, and reads whole", () => {
  const { container } = render(<SiteLink site={SITE} whole wraps />);
  const link = container.firstElementChild;
  const lines = (link?.innerHTML ?? "").replaceAll(/<\/?span[^>]*>/g, "").split("<wbr>");

  expect([lines, link?.textContent]).toEqual([["sales-", "report--", "abc123def456-", "p-poplin.example.com"], "sales-report--abc123def456-p-poplin.example.com"]);
});

// Drift: where a link's id is left out a screen reader would read the name and the end run together again, with nothing said of the part between them.
test.each([
  ["cut to fit a table", { gives: true }, 1],
  ["on one line", {}, 1],
  ["wrapped", { wraps: true }, 1],
  ["shown whole", { whole: true }, 0],
])("a link says that a part is hidden where the dots stand, and nothing of it once it is shown: %s", (_what, how, said) => {
  const { container } = render(<SiteLink site={SITE} {...how} />);

  expect(within(container).queryAllByRole("img", { name: "part hidden" }).length).toBe(said);
});
