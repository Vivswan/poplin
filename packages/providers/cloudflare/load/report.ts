// What a load run measured, as the page a person reads: one table a scenario, then every place a number crosses or nears a limit of the provider's free plan, the worst first.
//
//   a bend            when
//   failed            a request of a row or of a burst answered neither what it should nor the refusal it may
//   crosses, nears    one request asks the database 50 queries or more, or 40 or more
//   a day             a request anyone may send: fewer than 100,000 of it fit the day's rows read or written. A request of the owner's: fewer than 1,000
//                     a scheduled run: the 96 of a day use a tenth of either or more
//   grows             a cost that should stay flat is larger at the largest size than at the one before it
//   slow              one request took 10 ms or more by the clock, on average over its row, the local database and bucket included: about, and no measure of processing time

import type { Axis } from "./profiles";

/** What the provider's free plan gives: the queries and the processing time of one request, and the requests, the rows, and the scheduled runs of one day. */
const FREE_PLAN = { queries: 50, ms: 10, requests: 100_000, read: 5_000_000, written: 100_000, runs: 96 } as const;

/** The queries of one request from which it nears the plan's 50: the most the budget of a request lets one spend. */
const NEAR_QUERIES = 40;

/** How many of one request of the owner's a day must have room for: under it, the request is a bend. */
const OWNER_REQUESTS = 1000;

/** The part of a day's rows from which the scheduled runs of a day are a bend. */
const RUNS_SHARE = 0.1;

/** The order the kinds of bend are listed in. */
const KINDS = ["failed", "crosses", "a day", "nears", "grows", "slow"] as const;

/** The counts a cost holds, in the order a table shows them. */
const COUNTS = ["queries", "read", "written", "bucket"] as const;

/** What one request cost. */
export interface Cost {
  /** The queries to the database, a batch being one. */
  readonly queries: number;

  /** The rows the database read. */
  readonly read: number;

  /** The rows the database wrote. */
  readonly written: number;

  /** The calls to the bucket of every kind. */
  readonly bucket: number;

  /** The milliseconds by the clock. */
  readonly ms: number;
}

/** One scenario at one size. */
export interface LoadLine {
  /** What was asked. */
  readonly scenario: string;

  /** The thing of the fill the scenario is measured across. */
  readonly axis: Axis;

  /** How much of that thing the install held. */
  readonly size: number;

  /** Whether the cost should be the same at every size. */
  readonly flat: boolean;

  /** Whether it is a scheduled run, of which a day has 96, and no request. */
  readonly run: boolean;

  /** Whether anyone may send the request, with no login: a day may bring as many of it as the plan has requests. */
  readonly open: boolean;

  /** The first request, on an instance that reads the settings anew. */
  readonly once: Cost;

  /** The requests after it, one after another: how many, how many of them failed, how many were refused as they may be, and what one cost on average. */
  readonly row: { readonly asked: number; readonly failed: number; readonly refused: number; readonly mean: Cost };

  /** The requests then sent at once: how many, how many failed, how many were refused as they may be, and the milliseconds until the last was answered. */
  readonly burst: { readonly asked: number; readonly failed: number; readonly refused: number; readonly ms: number };

  /** What the first request that failed answered: its status and the start of its body. Absent where none failed. */
  readonly failure?: string;
}

/** One place a number crosses or nears a limit. */
export interface Bend {
  /** Which rule it is a bend by. */
  readonly kind: (typeof KINDS)[number];

  /** What was asked. */
  readonly scenario: string;

  /** The thing of the fill the scenario is measured across. */
  readonly axis: Axis;

  /** The smallest size it shows at. */
  readonly size: number;

  /** What bends, in words. */
  readonly what: string;

  /** How many of the request a day's free plan takes, where a day's rows bound it; `undefined` for a bend of one request. */
  readonly fits?: number;
}

/** A number as a person reads it: a comma between the thousands, and one decimal for what is no whole number. */
function shown(count: number): string {
  return (Math.round(count * 10) / 10).toLocaleString("en-US");
}

/** What a day's requests of one kind cost on average: the row's, where it was asked, else the first one's. */
function usual(line: LoadLine): Cost {
  return line.row.asked > 0 ? line.row.mean : line.once;
}

/** The bend of a day's rows, for a request or a scheduled run; `undefined` where the day holds it. */
function dayBend(line: LoadLine): Pick<Bend, "kind" | "what" | "fits"> | undefined {
  const cost = usual(line);
  const [rows, limit, name] = cost.read / FREE_PLAN.read >= cost.written / FREE_PLAN.written ? [cost.read, FREE_PLAN.read, "read"] : [cost.written, FREE_PLAN.written, "written"];
  if (rows === 0) return undefined;

  const fits = Math.floor(limit / rows);
  if (line.run) {
    const share = (FREE_PLAN.runs * rows) / limit;

    return share < RUNS_SHARE ? undefined : { kind: "a day", fits, what: `${shown(rows)} rows ${name} a run: a day's ${FREE_PLAN.runs} runs use ${shown(share * 100)}% of the day's rows ${name}` };
  }

  if (fits >= (line.open ? FREE_PLAN.requests : OWNER_REQUESTS)) return undefined;

  // The rows a visit writes are the day's count, which an install samples once the day is past its first requests.
  const sampled = line.open && name === "written" ? ", were every one counted: an install counts a sample of a day's later requests" : "";

  return { kind: "a day", fits, what: `${shown(rows)} rows ${name} a request: ${shown(fits)} a day use up the day's ${shown(limit)} rows ${name}${sampled}` };
}

/** The bends of one line by itself. */
function bendsOfLine(line: LoadLine): Pick<Bend, "kind" | "what" | "fits">[] {
  const bends: Pick<Bend, "kind" | "what" | "fits">[] = [];
  const failed = line.row.failed + line.burst.failed;
  if (failed > 0) bends.push({ kind: "failed", what: `${failed} of ${line.row.asked + line.burst.asked} requests failed, ${line.row.failed} in a row and ${line.burst.failed} of a burst; the first answered ${line.failure}` });

  // A row whose requests ask more on average than the first one did holds a request that asked at least as much.
  const queries = Math.ceil(Math.max(line.once.queries, line.row.mean.queries));
  if (queries >= FREE_PLAN.queries) bends.push({ kind: "crosses", what: `${queries} queries in one request: the plan answers ${FREE_PLAN.queries}` });
  else if (queries >= NEAR_QUERIES) bends.push({ kind: "nears", what: `${queries} queries in one request: ${FREE_PLAN.queries - queries} under the plan's ${FREE_PLAN.queries}` });

  const day = dayBend(line);
  if (day !== undefined) bends.push(day);

  const { ms } = usual(line);
  if (ms >= FREE_PLAN.ms) bends.push({ kind: "slow", what: `about ${shown(ms)} ms by the clock, the local database and bucket included: the plan gives ${FREE_PLAN.ms} ms of processing` });

  return bends;
}

/** The bend of a flat scenario whose cost grew between its two largest sizes, where every page is full; `undefined` where it did not. */
function growth(lines: readonly LoadLine[]): Bend | undefined {
  const [first, last] = [lines.at(-2), lines.at(-1)];
  if (first === undefined || last === undefined || !first.flat) return undefined;

  const grown = COUNTS.filter((count) => last.once[count] > first.once[count]).map((count) => `${count} ${shown(first.once[count])} -> ${shown(last.once[count])}`);
  if (grown.length === 0) return undefined;

  return { kind: "grows", scenario: last.scenario, axis: last.axis, size: last.size, what: `grows from ${shown(first.size)} to ${shown(last.size)} ${last.axis} where it should be flat: ${grown.join(", ")}` };
}

/** One bend for the bends of one kind a scenario shows, the smallest size first: at that size, in the numbers of the size with the fewest a day, or of the largest. */
function worstOf(shows: readonly Bend[]): Bend | undefined {
  const [first] = shows;
  if (first === undefined) return undefined;

  const worst = shows.reduce((so, bend) => ((bend.fits ?? 0) <= (so.fits ?? 0) && bend.what !== so.what ? bend : so), first);
  if (worst.size === first.size) return first;

  return { ...worst, size: first.size, what: `${worst.what}, at ${shown(worst.size)} ${worst.axis}` };
}

/** The lines of each scenario, in the order the scenarios first appear, each from its smallest size on. */
function byScenario(lines: readonly LoadLine[]): LoadLine[][] {
  const scenarios = new Map<string, LoadLine[]>();
  for (const line of lines) scenarios.set(line.scenario, [...(scenarios.get(line.scenario) ?? []), line]);

  return [...scenarios.values()].map((group) => [...group].sort((a, b) => a.size - b.size));
}

/**
 * Find every place a run's numbers cross or near a limit of the free plan.
 *
 * @returns the bends, the worst first: by their kind, then the fewest a day, then the largest size; one bend a scenario and kind, at the smallest size it shows at, in the numbers of the size it is worst at
 */
export function bendsOf(lines: readonly LoadLine[]): Bend[] {
  const bends = byScenario(lines).flatMap((group) => {
    const own = group.flatMap((line) => bendsOfLine(line).map((bend) => ({ ...bend, scenario: line.scenario, axis: line.axis, size: line.size })));
    const each = KINDS.flatMap((kind) => worstOf(own.filter((bend) => bend.kind === kind)) ?? []);
    const grown = growth(group);

    return grown === undefined ? each : [...each, grown];
  });

  return [...bends].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.fits ?? 0) - (b.fits ?? 0) || b.size - a.size);
}

/** One scenario's table: a row a size. */
function tableOf(group: readonly LoadLine[]): string {
  const [first] = group;
  if (first === undefined) return "";

  const head = `| ${first.axis} | queries | rows read | rows written | bucket calls | about ms | in a row: failed | rows read, written each | at once: failed | refused | ms |`;
  const rows = group.map(({ size, once, row, burst }) => {
    const each = row.asked === 0 ? "-" : `${shown(row.mean.read)}, ${shown(row.mean.written)}`;
    const inRow = `${row.failed} of ${row.asked}${row.refused === 0 ? "" : `, ${row.refused} refused`}`;
    const cells = [shown(size), once.queries, shown(once.read), shown(once.written), shown(once.bucket), shown(once.ms), inRow, each, `${burst.failed} of ${burst.asked}`, burst.refused, shown(burst.ms)];

    return `| ${cells.join(" | ")} |`;
  });

  return [`### ${first.scenario}`, "", head, `|${" --- |".repeat(11)}`, ...rows, ""].join("\n");
}

/** A scenario whose test failed, with the first line of why: one that stopped before a size was measured has no line of that size. */
export interface Unfinished {
  /** What was asked. */
  readonly scenario: string;

  /** The first line of the failure. */
  readonly why: string;
}

/**
 * Write a load run as a Markdown page.
 *
 * @param profile - what the run is called
 * @param unfinished - the scenarios whose test failed
 * @returns one table a scenario, a row a size, then the scenarios that failed, then the bends, the worst first
 */
export function loadReport(profile: string, lines: readonly LoadLine[], unfinished: readonly Unfinished[] = []): string {
  const bends = bendsOf(lines).map((bend, at) => `| ${at + 1} | ${bend.kind} | ${bend.scenario} | ${shown(bend.size)} ${bend.axis} | ${bend.what} |`);
  const limits = `One request: ${FREE_PLAN.queries} database queries, ${FREE_PLAN.ms} ms of processing. One day: ${shown(FREE_PLAN.requests)} requests, ${shown(FREE_PLAN.read)} rows read, ${shown(FREE_PLAN.written)} rows written.`;

  return [
    `# Load test: the ${profile} run`,
    "",
    "Measured on the local Workers runtime with the real database driver. Each row is one request on an instance that reads the settings anew, then a row of the same request, then a burst of it at once.",
    "",
    limits,
    "",
    "## What each request costs",
    "",
    ...byScenario(lines).map(tableOf),
    ...(unfinished.length === 0 ? [] : ["## Failed", "", "| Scenario | Why |", "| --- | --- |", ...unfinished.map(({ scenario, why }) => `| ${scenario} | ${why.replaceAll("|", "/")} |`), ""]),
    "## Bends",
    "",
    "| # | Kind | Scenario | From | What bends |",
    "| --- | --- | --- | --- | --- |",
    ...(bends.length === 0 ? ["| - | none | | | |"] : bends),
    "",
  ].join("\n");
}
