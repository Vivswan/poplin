// The comment a pull request keeps on what each action costs, written from two runs' costs made up by hand.
// Drift: the comment is the one place a person sees that a change made a request costlier before it lands. A row that went up and showed as unchanged, or a row over its budget that went unmarked, would let it land unseen.

import { describe, expect, test } from "bun:test";

import { costsComment } from "../../scripts/action-costs";

/** The address of the run a comment links. */
const RUN = "https://example.com/owner/name/actions/runs/7";

/** What every comment ends with. */
const LINK = `Every action: <a href="${RUN}">the summary of this run</a>\n`;

/** The head of the table of changed rows. */
const HEAD = "<tr><th>Action</th><th>Database queries</th><th>Rows read</th><th>Rows written</th><th>Storage reads</th><th>Storage writes</th><th>Storage lists</th></tr>";

/** A row that costs 5 queries, 7 rows read, 2 rows written, and one read of the storage, inside its budget. */
const PAGE = { name: "a page", queries: 5, read: 7, written: 2, gets: 1, heads: 0, puts: 0, lists: 0, budget: { queries: 5, reads: 1, writes: 0 } };

/** A row that lists the storage once. */
const LISTING = { name: "a listing", queries: 4, read: 7, written: 1, gets: 0, heads: 0, puts: 0, lists: 1, budget: { queries: 4, reads: 0, writes: 1 } };

/** The page known to be over a ceiling. */
const KNOWN = { ...PAGE, known: "it reads its sites one by one" };

/** What a comment holds between its heading and its link, for the costs of main and of this run. */
const COMMENTS: readonly (readonly [what: string, main: Compared["main"], now: Compared["now"], body: string])[] = [
  ["main has no run yet", "none", { rows: [PAGE], unmeasured: [] }, "No run on main to compare with yet.\n"],
  ["main's costs could not be read", "unread", { rows: [PAGE], unmeasured: [] }, "The costs of the newest run on main could not be read, so nothing is compared.\n"],
  ["nothing changed", [PAGE, LISTING], { rows: [PAGE, LISTING], unmeasured: [] }, "No change against main.\n"],
  [
    "a row went up in queries and down in rows read, and the other stayed",
    [PAGE, LISTING],
    { rows: [{ ...PAGE, queries: 6, read: 3, budget: { queries: 6, reads: 1, writes: 0 } }, LISTING], unmeasured: [] },
    `<table>${HEAD}<tr><td>a page</td><td>5 &rarr; <b>6</b> &uarr;</td><td>7 &rarr; <b>3</b> &darr;</td><td>2</td><td>1</td><td>0</td><td>0</td></tr></table>\n`,
  ],
  [
    "a row is new and another is gone",
    [PAGE],
    { rows: [LISTING], unmeasured: [] },
    `<table>${HEAD}<tr><td>a listing (new)</td><td>4</td><td>7</td><td>1</td><td>0</td><td>0</td><td>1</td></tr><tr><td>a page (gone)</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr></table>\n`,
  ],
  [
    "a row's test failed before it was measured: it is said so, and is not taken for a row that is gone",
    [PAGE, LISTING],
    { rows: [LISTING], unmeasured: ["a page"] },
    "No change against main.\nNot measured, since its test failed first:\n<ul><li>a page</li></ul>\n",
  ],
  [
    "a row is over its budget of queries and of storage reads",
    [PAGE],
    { rows: [{ ...PAGE, queries: 6, gets: 2 }], unmeasured: [] },
    `<table>${HEAD}<tr><td>a page</td><td>5 &rarr; <b>6</b> &uarr;</td><td>7</td><td>2</td><td>1 &rarr; <b>2</b> &uarr;</td><td>0</td><td>0</td></tr></table>\n` +
      "<ul><li><b>a page</b> is over its budget: 6 database queries, budget 5; 2 storage reads, budget 1</li></ul>\n",
  ],
  ["a row is known to be over a ceiling", [KNOWN], { rows: [KNOWN], unmeasured: [] }, "No change against main.\nKnown to be over a ceiling:\n<ul><li>a page: 5 database queries. it reads its sites one by one</li></ul>\n"],
];

/** What a comment is written from. */
type Compared = Parameters<typeof costsComment>[0];

describe("the comment on what each action costs", () => {
  test.each(COMMENTS)("%s", (_what, main, now, body) => {
    expect(costsComment({ now, main, run: RUN })).toBe(`<h3>What each action costs</h3>\n${body}${LINK}`);
  });
});
