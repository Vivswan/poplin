// The report of the free-plan budget job, written from two runs' costs made up by hand.
// Drift: the first line and the summary are where a person sees that a change made a request costlier before it lands.
// A count that went up and read as unchanged, a row near a ceiling that went unmarked, or a broken budget under a quiet line would let it land unseen.

import { describe, expect, test } from "bun:test";
import { EOL } from "node:os";

import { budgetReport } from "../../scripts/free-plan-budget";
import type { CEILINGS } from "../../src/shared/limits/budget-ceilings";

/** What every summary ends with. */
const LEAD =
  "<p>Measured on the local Workers runtime with the real database driver. Cloudflare's limit beside the bucket calls is on one invocation's calls to all of its own services, the database and the bucket together.</p>\n";

/** The head of the table of the ceilings. */
const HEAD = "<tr><th>Ceiling</th><th>Worst action</th><th>Before (main)</th><th>After</th><th>Change</th><th>Cloudflare's limit</th><th>poplin's own limit</th><th>Used</th></tr>";

/** The cell of Cloudflare's limit on the queries of one invocation, as a row links it to D1's page. */
const QUERIES = '<td><a href="https://developers.cloudflare.com/d1/platform/limits/">50</a></td>';

/** The cell of Cloudflare's limit on the calls of one invocation to its own services, as a row links it to the Workers page. */
const SERVICE_CALLS = '<td><a href="https://developers.cloudflare.com/workers/platform/limits/#subrequests">1,000</a></td>';

/** The cells of Cloudflare's limits on the rows of a day, as a row links them to D1's page of what is free. */
const ROWS_A_DAY = {
  read: '<td><a href="https://developers.cloudflare.com/d1/platform/pricing/">5,000,000</a></td>',
  written: '<td><a href="https://developers.cloudflare.com/d1/platform/pricing/">100,000</a></td>',
} as const;

/** The head of the table of one group's rows. */
const GROUP =
  "<tr><th>Action</th><th>Most of a ceiling</th><th>Database queries</th><th>Most allowed</th><th>Rows read</th><th>Rows written</th>" +
  "<th>Storage reads</th><th>Storage writes</th><th>Storage lists</th><th>Storage deletes</th><th>About ms</th><th>Note</th></tr>";

/** What a page view that reads the storage once spends of the reads it may make. */
const ONE_READ = { ceiling: "Bucket reads, one page view", spent: 1, most: 3, exact: true };

/** A page view of 5 queries, 7 rows read, 2 rows written, and one read of the storage: one of the three reads a page view may make in full. */
const PAGE = {
  group: "One page view of a site",
  name: "a page",
  queries: 5,
  read: 7,
  written: 2,
  gets: 1,
  heads: 0,
  puts: 0,
  lists: 0,
  deletes: 0,
  ms: 3,
  budget: { queries: 5, reads: 1, writes: 0 },
  uses: [
    { ceiling: "Database queries, one request", spent: 5, most: 40 },
    ONE_READ,
  ],
};

/** A copy that makes 205 of the 250 bucket calls one request may, and reads 1,200 rows. */
const COPY = {
  group: "Publishing",
  name: "a copy",
  queries: 8,
  read: 1200,
  written: 24,
  gets: 100,
  heads: 0,
  puts: 104,
  lists: 1,
  deletes: 0,
  ms: 40,
  budget: { queries: 8, reads: 100, writes: 105 },
  uses: [
    { ceiling: "Database queries, one request", spent: 8, most: 40 },
    { ceiling: "Bucket calls, one request", spent: 205, most: 250 },
  ],
};

/** The page with one query more, and a budget that lets it through. */
const COSTLIER = { ...PAGE, queries: 6, budget: { queries: 6, reads: 1, writes: 0 }, uses: [{ ceiling: "Database queries, one request", spent: 6, most: 40 }, ONE_READ] };

/** The page over the queries of one request, under a budget that lets it through. */
const OVER = { ...PAGE, queries: 44, budget: { queries: 44, reads: 1, writes: 0 }, uses: [{ ceiling: "Database queries, one request", spent: 44, most: 40 }, ONE_READ] };

/** The page that reads the storage as often as a page view may, by design, and as often as its budget lets it. */
const IN_FULL = { ...PAGE, gets: 3, budget: { queries: 5, reads: 3, writes: 0 }, uses: [{ ceiling: "Database queries, one request", spent: 5, most: 40 }, { ...ONE_READ, spent: 3 }] };

/**
 * What a row spends of each ceiling: half of the limit the ceiling holds it to, and the bucket reads of a page view in full.
 * A ceiling declared with no entry here does not compile.
 */
const OF_EACH: Readonly<Record<keyof typeof CEILINGS, { readonly spent: number; readonly most: number; readonly exact?: true }>> = {
  "Database queries, one request": { spent: 20, most: 40 },
  "Database queries, one scheduled run": { spent: 20, most: 40 },
  "Bucket calls, one request": { spent: 125, most: 250 },
  "Bucket reads, one page view": { spent: 3, most: 3, exact: true },
  "Every call, one scheduled run": { spent: 150, most: 300 },
  "Rows read, of one day's": { spent: 2_500_000, most: 5_000_000 },
  "Rows written, of one day's": { spent: 50_000, most: 100_000 },
};

/** The costs of a run that measured the rows. */
function run(...rows: Compared["now"]["rows"]): Compared["now"] {
  return { rows, unmeasured: [], actions: [] };
}

/** What a run says first and how loud its annotation is, for the costs of main and of this run. A run that is no pull request has no costs of main, and no annotation. */
const LINES: readonly (readonly [what: string, main: Compared["main"], now: Compared["now"], level: Report["level"], line: string])[] = [
  ["a run of main states the standing alone", undefined, run(PAGE, COPY), undefined, 'All within budget. Closest: "a copy" at 82% of Bucket calls, one request.'],
  ["an allowance spent in full is not the closest: the fullest of the others is", undefined, run(IN_FULL), undefined, 'All within budget. Closest: "a page" at 13% of Database queries, one request.'],
  [
    "an allowance that may be spent in full is broken once it is exceeded",
    undefined,
    run({ ...IN_FULL, gets: 4, budget: { queries: 5, reads: 4, writes: 0 }, uses: [{ ...ONE_READ, spent: 4 }] }),
    undefined,
    'Not within budget: "a page" is at 133% of Bucket reads, one page view.',
  ],
  ["main has no run yet", "none", run(PAGE), "notice", "No run on main to compare with yet."],
  ["main's costs could not be read", "unread", run(PAGE), "notice", "The costs of the newest run on main could not be read, so nothing is compared."],
  ["nothing changed", [PAGE, COPY], run(PAGE, COPY), "notice", "This change does not change any action's cost."],
  ["a count went up", [PAGE], run(COSTLIER), "warning", 'This change raises "a page" by 1 database query (+20%). Everything else is unchanged.'],
  ["a count went down", [PAGE], run({ ...PAGE, read: 3 }), "notice", 'This change lowers "a page" by 4 rows read (-57%). Everything else is unchanged.'],
  ["a count that was zero went up: no share of nothing", [PAGE], run({ ...PAGE, puts: 2, budget: { ...PAGE.budget, writes: 2 } }), "warning", 'This change raises "a page" by 2 storage writes. Everything else is unchanged.'],
  ["a row is gone", [PAGE, COPY], run(PAGE), "notice", 'This change removes "a copy". Everything else is unchanged.'],
  [
    "a removal from the storage over the row's budget of none",
    [PAGE],
    run({ ...PAGE, deletes: 1 }),
    "error",
    'This change raises "a page" by 1 storage delete. Everything else is unchanged. Not within budget: "a page" is over its budget: 1 storage deletes, budget 0.',
  ],
  [
    "five things moved: the three largest are named, a new row before a count that doubled before a smaller share",
    [PAGE],
    run({ ...COSTLIER, read: 3, written: 4, gets: 2, budget: { queries: 6, reads: 2, writes: 0 } }, COPY),
    "warning",
    'This change adds "a copy", raises "a page" by 2 rows written (+100%), raises "a page" by 1 storage read (+100%), and 2 more. Everything else is unchanged.',
  ],
  [
    "a row is over a ceiling",
    [PAGE],
    run(OVER),
    "error",
    'This change raises "a page" by 39 database queries (+780%). Everything else is unchanged. Not within budget: "a page" is at 110% of Database queries, one request.',
  ],
  [
    "a row is over its own budget",
    [PAGE],
    run({ ...COSTLIER, budget: PAGE.budget }),
    "error",
    'This change raises "a page" by 1 database query (+20%). Everything else is unchanged. Not within budget: "a page" is over its budget: 6 database queries, budget 5.',
  ],
  [
    "a row's test failed before it was measured: it is said so, and is not taken for a row that is gone",
    [PAGE, COPY],
    { ...run(COPY), unmeasured: ["a page"] },
    "error",
    'This change does not change any action\'s cost. Not within budget: "a page" was not measured, since its test failed first.',
  ],
];

/** What a report is written from. */
type Compared = Parameters<typeof budgetReport>[0];

/** What a run reports. */
type Report = ReturnType<typeof budgetReport>;

/** The summary of a run, each line ended with a line feed: the summary ends them as the machine it runs on does. */
function summaryOf(compared: Compared): string {
  return budgetReport(compared).html.replaceAll(EOL, "\n");
}

describe("the report of the free-plan budget", () => {
  test.each(LINES)("the first line and the annotation: %s", (_what, main, now, level, line) => {
    const report = budgetReport({ now, ...(main === undefined ? {} : { main }) });

    expect([report.level, report.line]).toEqual([level, line]);
  });

  // The whole first screen of a pull request that moved one count: the line, the standing, the one mover, then the ceilings with the fullest first and marked.
  test("the summary of a change that raised one count leads with it, lists what moved, and sorts the ceilings by the share spent", () => {
    const folded =
      `<details><summary>One page view of a site</summary><table>${GROUP}<tr><td>a page</td><td>15%</td><td>6</td><td>6</td><td>7</td><td>2</td><td>1</td><td>0</td><td>0</td><td>0</td><td>3</td><td>-</td></tr></table>\n</details>\n` +
      `<details><summary>Publishing</summary><table>${GROUP}<tr><td>a copy</td><td><b>82%</b> &#9888;</td><td>8</td><td>8</td><td>1,200</td><td>24</td><td>100</td><td>104</td><td>1</td><td>0</td><td>40</td><td>-</td></tr></table>\n</details>\n`;

    expect(summaryOf({ now: run(COSTLIER, COPY), main: [PAGE, COPY] })).toBe(
      "<h2>Free-plan budget</h2>\n" +
        '<p>This change raises "a page" by 1 database query (+20%). Everything else is unchanged.</p>\n' +
        '<p>All within budget. Closest: "a copy" at 82% of Bucket calls, one request.</p>\n' +
        "<h3>What changed</h3>\n" +
        "<table><tr><th>Action</th><th>Count</th><th>Before</th><th>After</th><th>Change</th></tr><tr><td>a page</td><td>Database queries</td><td>5</td><td>6</td><td>+1 (+20%)</td></tr></table>\n" +
        `<table>${HEAD}` +
        `<tr><td>Bucket calls, one request</td><td>a copy</td><td>205</td><td>205</td><td>no change</td>${SERVICE_CALLS}<td>250</td><td><b>82%</b> of poplin's own &#9888;</td></tr>` +
        `<tr><td>Database queries, one request</td><td>a copy</td><td>8</td><td>8</td><td>no change</td>${QUERIES}<td>40</td><td>20% of poplin's own</td></tr>` +
        `<tr><td>Bucket reads, one page view</td><td>a page</td><td>1</td><td>1</td><td>no change</td>${SERVICE_CALLS}<td>3</td><td>1 of poplin's own 3 (allowed in full)</td></tr>` +
        `</table>\n${folded}${LEAD}`,
    );
  });

  // The ceiling's own worst moved, a row is known to be over one, and the actions a person does have their table.
  test("the summary of a change that moved a ceiling's worst row says how far, lists a row known to be over a ceiling apart, and folds the actions away", () => {
    const known = { ...OVER, known: "it reads its sites one by one" };
    const actions = [{ Action: "Open a page", Requests: 1, "Database queries": 44 }];
    const row = "<tr><td>a page</td><td><b>110%</b> &#9888;</td><td>44</td><td>44</td><td>7</td><td>2</td><td>1</td><td>0</td><td>0</td><td>0</td><td>3</td><td>it reads its sites one by one</td></tr>";

    expect(summaryOf({ now: { ...run(known, { ...COPY, queries: 4, budget: { ...COPY.budget, queries: 4 }, uses: [{ ceiling: "Database queries, one request", spent: 4, most: 40 }] }), actions }, main: [known, COPY] })).toBe(
      "<h2>Free-plan budget</h2>\n" +
        '<p>This change lowers "a copy" by 4 database queries (-50%). Everything else is unchanged.</p>\n' +
        '<p>All within budget. Closest: "a copy" at 10% of Database queries, one request.</p>\n' +
        "<h3>What changed</h3>\n" +
        "<table><tr><th>Action</th><th>Count</th><th>Before</th><th>After</th><th>Change</th></tr><tr><td>a copy</td><td>Database queries</td><td>8</td><td>4</td><td>-4 (-50%)</td></tr></table>\n" +
        "<p>Known to be over a ceiling:</p>\n<ul><li>a page: 44 database queries. it reads its sites one by one</li></ul>\n" +
        `<table>${HEAD}<tr><td>Database queries, one request</td><td>a copy</td><td>8</td><td>4</td><td>-4 (-50%)</td>${QUERIES}<td>40</td><td>10% of poplin's own</td></tr></table>\n` +
        "<details><summary>What a person does</summary><table><tr><th>Action</th><th>Requests</th><th>Database queries</th></tr><tr><td>Open a page</td><td>1</td><td>44</td></tr></table>\n</details>\n" +
        `<details><summary>One page view of a site</summary><table>${GROUP}${row}</table>\n</details>\n` +
        `<details><summary>Publishing</summary><table>${GROUP}<tr><td>a copy</td><td>10%</td><td>4</td><td>4</td><td>1,200</td><td>24</td><td>100</td><td>104</td><td>1</td><td>0</td><td>40</td><td>-</td></tr></table>\n</details>\n` +
        LEAD,
    );
  });

  // A run of main compares nothing: no line on a change, no table of what changed, and no number of main's.
  // The allowance the page spends in full by design carries no mark, and sits under the ceilings that are measured.
  test("the summary of a run of main states the standing, leaves every cell of main's empty, and shows an allowance spent in full last and unmarked", () => {
    expect(summaryOf({ now: run(IN_FULL) })).toBe(
      "<h2>Free-plan budget</h2>\n" +
        '<p>All within budget. Closest: "a page" at 13% of Database queries, one request.</p>\n' +
        `<table>${HEAD}` +
        `<tr><td>Database queries, one request</td><td>a page</td><td>-</td><td>5</td><td>-</td>${QUERIES}<td>40</td><td>13% of poplin's own</td></tr>` +
        `<tr><td>Bucket reads, one page view</td><td>a page</td><td>-</td><td>3</td><td>-</td>${SERVICE_CALLS}<td>3</td><td>3 of poplin's own 3 (allowed in full)</td></tr>` +
        "</table>\n" +
        `<details><summary>One page view of a site</summary><table>${GROUP}<tr><td>a page</td><td>13%</td><td>5</td><td>5</td><td>7</td><td>2</td><td>3</td><td>0</td><td>0</td><td>0</td><td>3</td><td>-</td></tr></table>\n</details>\n` +
        LEAD,
    );
  });

  // Drift: the column that held one number for both read a line of poplin's own as what Cloudflare allows, and a share of Cloudflare's limit as a share of poplin's.
  // A ceiling added with no line of its own, or with no limit of Cloudflare's beside it, would show an empty cell.
  test("every ceiling shows Cloudflare's limit as a link to the page that states it, poplin's own line or none where it draws none, and whose limit the share is of", () => {
    const every = { ...PAGE, uses: Object.entries(OF_EACH).map(([ceiling, use]) => ({ ceiling, ...use })) };
    const rows = [
      ["Database queries, one request", "20", QUERIES, "40", "50% of poplin's own"],
      ["Database queries, one scheduled run", "20", QUERIES, "40", "50% of poplin's own"],
      ["Bucket calls, one request", "125", SERVICE_CALLS, "250", "50% of poplin's own"],
      ["Every call, one scheduled run", "150", SERVICE_CALLS, "300", "50% of poplin's own"],
      ["Rows read, of one day's", "2,500,000", ROWS_A_DAY.read, "none", "50% of Cloudflare's"],
      ["Rows written, of one day's", "50,000", ROWS_A_DAY.written, "none", "50% of Cloudflare's"],
      ["Bucket reads, one page view", "3", SERVICE_CALLS, "3", "3 of poplin's own 3 (allowed in full)"],
    ].map(([ceiling, spent, cloudflare, own, used]) => `<tr><td>${ceiling}</td><td>a page</td><td>-</td><td>${spent}</td><td>-</td>${cloudflare}<td>${own}</td><td>${used}</td></tr>`);

    expect(summaryOf({ now: run(every) })).toContain(`<table>${HEAD}${rows.join("")}</table>`);
  });
});
