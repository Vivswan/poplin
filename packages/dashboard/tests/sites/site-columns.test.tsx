// A site's link as text: the places a shown link offers to go on in the next line. Where a browser then breaks it is its layout's, which this page does not have.

import { clearPage } from "../lib/support/page";

import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { SiteLink } from "@/sites/site-columns";

/** A site whose link holds its name, its id, and a word after it. */
const SITE = { id: "abc123def456", url: "https://sales-report--abc123def456-p-poplin.example.com/" };

afterEach(cleanup);
afterAll(clearPage);

// Drift: a place to break would go missing after a dash, so a long link would have to break inside a word; or one would be offered between the two dashes before the id; or the text a selection copies would change.
test("a shown link that wraps offers a break after each run of dashes, and reads whole", () => {
  const { container } = render(<SiteLink site={SITE} whole wraps />);
  const link = container.firstElementChild;
  const lines = (link?.innerHTML ?? "").replaceAll(/<\/?span[^>]*>/g, "").split("<wbr>");

  expect([lines, link?.textContent]).toEqual([["sales-", "report--", "abc123def456-", "p-", "poplin.example.com"], "sales-report--abc123def456-p-poplin.example.com"]);
});
