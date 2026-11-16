// The load of a live run, against a local fake: what it says it will write, that it sends nothing over a ceiling, and that it tells the install's own refusal from a wrong answer.
// Drift: the load runs by hand alone, on an account whose day of rows is small. A plan that counts less than the load writes, or a ceiling that holds nothing back, would be found on that account and nowhere before it.

import { afterEach, describe, expect, test } from "bun:test";

import type { Fetch } from "../../../../../cli/src/client/client";
import { CEILINGS, meterBucket } from "../../../scripts/live/budget";
import { meterRows, ROW_CEILINGS } from "../../../scripts/live/rows";
import { openBench } from "../../../live/bench";
import { LOAD_SIZES, type LoadSizes, loadChecks, loadPlan } from "../../../live/checks/load";
import type { Outcome } from "../../../live/records";
import { runCheck } from "../../../live/report";
import { type FakeSwitches, openFake } from "../support/fake-install";

/** How long one run of the load may take, in milliseconds: its publishes and its hundred visits are all work of this process. */
const RUN_MS = 30_000;

/** The rows the meter counts under the plan: a request for a file a site does not hold writes its two rows, and the meter counts a visit that was served alone. */
const UNCOUNTED = 2 * 2 * LOAD_SIZES.missing;

/** The bucket writes and lists the meter counts under the plan: it counts a copy as one request, and the plan counts each file the copy writes and its two lists. */
const UNMETERED = LOAD_SIZES.files + 1;

/** Where the API answers. */
const API = "/api/";

/** The benches a test opened, closed after it. */
const OPENED: (() => void)[] = [];

/** What one run of the load came to. */
interface Ran {
  /** What the check came to. */
  readonly result: Outcome["result"];

  /** The first line of the failure the check reported. */
  readonly failure: string | undefined;

  /** Every line it said. */
  readonly said: readonly string[];

  /** How many requests it sent, the sweep's left out. */
  readonly sent: number;

  /** The rows the meter counted, the sweep's removals among them. */
  readonly rows: number;

  /** The bucket writes and lists the meter counted, the sweep's among them. */
  readonly bucket: number;
}

/**
 * Run the load on a fake install, then the sweep of a run.
 *
 * @param answers - stands in for the fake's answer to a visit, by how many visits came before; `undefined` lets the fake answer
 */
async function ranLoad(switches: FakeSwitches, sizes: LoadSizes, answers: (visit: number) => Response | undefined = () => undefined): Promise<Ran> {
  const fake = await openFake(switches);
  const counts = { sent: 0, visits: 0 };
  const watched: Fetch = async (input, init) => {
    counts.sent += 1;
    const visit = (init.method ?? "GET") === "GET" && !new URL(input).pathname.startsWith(API);
    const answer = visit ? answers(counts.visits) : undefined;
    if (visit) counts.visits += 1;

    return answer ?? fake.fetch(input, init);
  };
  const bucket = meterBucket(watched, CEILINGS.load);
  const rows = meterRows(bucket.fetch, ROW_CEILINGS.load);
  const said: string[] = [];
  const parts = { addresses: fake.addresses, token: fake.token, run: "selftest", missing: {}, fetch: rows.fetch, pause: fake.pause, now: fake.now, manyFiles: 1, largeCopy: 1 };
  const { bench, sweep, close } = openBench({ ...parts, say: (line) => said.push(line) });
  OPENED.push(close);

  let failure: string | undefined;
  const [check] = loadChecks(sizes);
  if (check === undefined) throw new Error("the load holds no check");

  const outcome = await runCheck(bench, check, (error) => {
    failure = String(error).split("\n")[0];
  });
  const { sent } = counts;
  await sweep();

  return { result: outcome.result, failure, said, sent, rows: rows.written(), bucket: bucket.spent() };
}

afterEach(() => {
  for (const close of OPENED.splice(0)) close();
});

describe("the load of a live run, against a local fake", () => {
  test.each<readonly [what: string, switches: FakeSwitches]>([
    ["an install under a domain", {}],
    ["an install without a domain", { noDomain: true }],
  ])(
    "on %s the load passes, says its plan first and no address, and the meters count what it planned",
    async (_what, switches) => {
      const plan = loadPlan(LOAD_SIZES);
      const ran = await ranLoad(switches, LOAD_SIZES);

      expect({ result: ran.result, failure: ran.failure, rows: ran.rows, bucket: ran.bucket }).toEqual({ result: "passed", failure: undefined, rows: plan.rows - UNCOUNTED, bucket: plan.bucket - UNMETERED });
      expect(ran.said.map((line) => line.replace(/\d+ ms/g, "N ms"))).toEqual([
        "load: at most 432 rows written of a ceiling of 600, 60 bucket writes and lists of a ceiling of 80, and 100 visits of one visitor's 120 a minute",
        "load: publish 5 sites of one page: mean N ms, most N ms",
        "load: publish a site of 20 files: mean N ms, most N ms",
        "load: open a page: 30 in a row, mean N ms, most N ms; 50 at once in N ms; 0 refused",
        "load: ask for a file the site does not hold: 10 in a row, mean N ms, most N ms; 10 at once in N ms; 0 refused",
        "load: list the sites: mean N ms, most N ms",
        "load: copy the site of 20 files: mean N ms, most N ms",
      ]);
    },
    RUN_MS,
  );

  test.each<readonly [what: string, sizes: LoadSizes, failure: string]>([
    ["more rows than its ceiling", { ...LOAD_SIZES, sites: 20 }, "Error: The load did not start: it would write 927 rows, over its ceiling of 600."],
    ["more bucket writes than its ceiling", { ...LOAD_SIZES, files: 31 }, "Error: The load did not start: it would ask the bucket for 82 writes and lists, over its ceiling of 80."],
    ["more visits than one visitor's minute holds", { ...LOAD_SIZES, burst: 80 }, "Error: The load did not start: it would send 130 visits, over the 120 one visitor's minute holds."],
  ])(
    "a load that plans %s says so and sends nothing",
    async (_what, sizes, failure) => {
      const ran = await ranLoad({}, sizes);

      expect({ result: ran.result, failure: ran.failure, sent: ran.sent, lines: ran.said.length, rows: ran.rows }).toEqual({ result: "failed", failure, sent: 0, lines: 1, rows: 0 });
    },
    RUN_MS,
  );

  test.each<readonly [what: string, answer: () => Response, result: Outcome["result"], refused: string]>([
    ["the install's own refusal, in its own words", () => new Response("Too many requests. Try again in 60 seconds.\n", { status: 429, headers: { "Retry-After": "60" } }), "passed", "20 refused"],
    ["a 429 in other words", () => new Response("error code: 1015", { status: 429 }), "failed", "0 refused"],
    ["the install's words with no time to wait", () => new Response("Too many requests. Try again in 60 seconds.\n", { status: 429 }), "failed", "0 refused"],
  ])(
    "visits answered with %s end the load %s",
    async (_what, answer, result, refused) => {
      // The last twenty visits of the page, all of its burst, are answered here in place of the fake.
      const from = LOAD_SIZES.row + LOAD_SIZES.burst - 20;
      const ran = await ranLoad({}, LOAD_SIZES, (visit) => (visit >= from && visit < LOAD_SIZES.row + LOAD_SIZES.burst ? answer() : undefined));

      expect({ result: ran.result, opened: ran.said.find((line) => line.startsWith("load: open a page"))?.endsWith(refused) }).toEqual({ result, opened: true });
    },
    RUN_MS,
  );
});
