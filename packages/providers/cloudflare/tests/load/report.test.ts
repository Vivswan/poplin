// The page of a load run: which numbers it calls a bend, in which order, and the table it writes of a scenario.
// Drift: the report is what says where an install stops on the free plan. A rule that calls nothing a bend prints an empty list, which reads as an install with no limit near.

import { describe, expect, test } from "vitest";
import { bendsOf, type Cost, type LoadLine, loadReport } from "../../load/report";

/** A request that costs next to nothing. */
const CHEAP: Cost = { queries: 2, read: 6, written: 0, bucket: 1, ms: 2 };

/** One line of a run, cheap and unfailing but for what a case changes. */
function line(changes: Partial<LoadLine> & { readonly cost?: Partial<Cost> } = {}): LoadLine {
  const once = { ...CHEAP, ...changes.cost };

  return {
    scenario: "a request",
    axis: "sites",
    size: 100,
    flat: true,
    run: false,
    open: false,
    once,
    row: { asked: 3, failed: 0, refused: 0, mean: once },
    burst: { asked: 10, failed: 0, refused: 0, ms: 5 },
    ...changes,
  };
}

describe("the bends of a load run", () => {
  test.for<readonly [name: string, lines: readonly LoadLine[], bends: readonly string[]]>([
    ["a cheap request that fails nowhere is no bend", [line()], []],
    ["50 queries cross the plan", [line({ cost: { queries: 50 } })], ["crosses: 50 queries in one request: the plan answers 50"]],
    ["40 queries near it", [line({ cost: { queries: 40 } })], ["nears: 40 queries in one request: 10 under the plan's 50"]],
    ["a row that asks more than the first request did crosses it too", [line({ row: { asked: 3, failed: 0, refused: 0, mean: { ...CHEAP, queries: 50.3 } } })], ["crosses: 51 queries in one request: the plan answers 50"]],
    ["an owner's request of which 1,000 a day fit is none", [line({ cost: { read: 5000 } })], []],
    ["an owner's request of which fewer fit is one", [line({ cost: { read: 5001 } })], ["a day: 5,001 rows read a request: 999 a day use up the day's 5,000,000 rows read"]],
    [
      "anyone's request is held to the plan's requests of a day, as a projection",
      [line({ open: true, cost: { written: 2 } })],
      ["a day: 2 rows written a request: 50,000 a day use up the day's 100,000 rows written, were every one counted: an install counts a sample of a day's later requests"],
    ],
    ["anyone's request of which 100,000 a day fit is none", [line({ open: true, cost: { read: 50, written: 1 } })], []],
    ["a scheduled run is held to its 96 a day", [line({ run: true, cost: { written: 168 } })], ["a day: 168 rows written a run: a day's 96 runs use 16.1% of the day's rows written"]],
    ["a scheduled run under a tenth of a day is none", [line({ run: true, cost: { written: 100 } })], []],
    ["a failed request names what it answered", [line({ burst: { asked: 10, failed: 2, refused: 0, ms: 5 }, failure: "500: no" })], ["failed: 2 of 13 requests failed, 0 in a row and 2 of a burst; the first answered 500: no"]],
    ["10 ms by the clock is slow", [line({ cost: { ms: 10 } })], ["slow: about 10 ms by the clock, the local database and bucket included: the plan gives 10 ms of processing"]],
    [
      "a flat cost that grows between the two largest sizes grows, and one that fills a page first does not",
      [line({ size: 10, cost: { read: 60 } }), line({ size: 100, cost: { read: 400 } }), line({ size: 1000, cost: { read: 400 } })],
      [],
    ],
    ["a flat cost larger at the largest size grows", [line({ size: 100, cost: { read: 400 } }), line({ size: 1000, cost: { read: 1400 } })], ["grows: grows from 100 to 1,000 sites where it should be flat: read 400 -> 1,400"]],
    ["a cost that may grow is no bend for growing", [line({ flat: false, size: 100, cost: { read: 400 } }), line({ flat: false, size: 1000, cost: { read: 1400 } })], []],
  ])("%s", ([, lines, bends]) => {
    expect(bendsOf(lines).map((bend) => `${bend.kind}: ${bend.what}`)).toEqual(bends);
  });

  test("the worst comes first: a failure, a crossing, the fewest a day, and each scenario once a kind, at the smallest size it shows at", () => {
    const lines = [
      line({ scenario: "graph", size: 100, cost: { read: 37_383 } }),
      line({ scenario: "graph", size: 1000, cost: { read: 37_383 } }),
      line({ scenario: "search", cost: { read: 500_000 } }),
      line({ scenario: "sweep", cost: { queries: 51 } }),
      line({ scenario: "publish", row: { asked: 3, failed: 1, refused: 0, mean: CHEAP }, failure: "503: spent" }),
    ];

    expect(bendsOf(lines).map((bend) => [bend.kind, bend.scenario, bend.size, bend.fits])).toEqual([
      ["failed", "publish", 100, undefined],
      ["crosses", "sweep", 100, undefined],
      ["a day", "search", 100, 10],
      ["a day", "graph", 100, 133],
    ]);
  });

  test("the page holds one table a scenario, a row a size from the smallest on, then the scenarios that failed, and the bends after them", () => {
    const lines = [line({ size: 1000, cost: { read: 1234 } }), line({ size: 10, row: { asked: 3, failed: 0, refused: 2, mean: CHEAP } }), line({ scenario: "another", row: { asked: 0, failed: 0, refused: 0, mean: CHEAP } })];
    const page = loadReport("full", lines, [{ scenario: "a third", why: "it answered 500 | no" }]);

    expect(page.split("\n").filter((row) => row.startsWith("### ") || /^\| (?:[\d,]+|a third) \|/.test(row))).toEqual([
      "### a request",
      "| 10 | 2 | 6 | 0 | 1 | 2 | 0 of 3, 2 refused | 6, 0 | 0 of 10 | 0 | 5 |",
      "| 1,000 | 2 | 1,234 | 0 | 1 | 2 | 0 of 3 | 1,234, 0 | 0 of 10 | 0 | 5 |",
      "### another",
      "| 100 | 2 | 6 | 0 | 1 | 2 | 0 of 0 | - | 0 of 10 | 0 | 5 |",
      "| a third | it answered 500 / no |",
      "| 1 | grows | a request | 1,000 sites | grows from 10 to 1,000 sites where it should be flat: read 6 -> 1,234 |",
    ]);
  });
});
