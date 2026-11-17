// The load of a live run: some of the scenarios of the load test, at small, fixed sizes, against a deployed install. It runs only on a run started by hand with the load switched on.
//
//   step                                      requests                                  rows written, at most    bucket writes and lists
//   publish `sites` sites of one page         one publish each                          23 each                  2 each
//   publish one site of `files` files         one publish                               23                       1 a file, and 1
//   open its page                             `row` one after another, `burst` at once  2 each                   none
//   ask for a file it does not hold           `missing` in a row, `missing` at once     2 each                   none
//   list the sites                            `lists` one after another                 none                     none
//   copy the site of `files` files            one command                               24                       1 a file, and 2
//   the run's sweep removes every site        one removal each                          13 each                  1 each
//
// Before it sends anything it says what it will write at the most, and it sends nothing where that is over a ceiling, or where its visits are more than one visitor's minute holds.
// Every answer must be the one the step asks for, or the install's own refusal of a visitor past its minute, in its own words. No line it says holds an address or a name.

import { expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { CEILINGS } from "../../scripts/live/budget";
import { ROW_CEILINGS, ROW_PRICES } from "../../scripts/live/rows";
import type { Bench, Check, LiveSite } from "../records";
import { under } from "../util";

/** The requests one visitor may send the test install in a minute: the setting every run gives it. */
const VISITOR_MINUTE = 120;

/** How long the load waits before its first visit, in milliseconds: past the minute the checks before it spent of its visitor's. */
const MINUTE_MS = 61_000;

/** What the install refuses a visitor past its minute with, and the header that says how long to wait. */
const REFUSAL = { status: 429, words: "Too many requests. Try again in ", header: "Retry-After" } as const;

/** How large a load is. */
export interface LoadSizes {
  /** The sites of one page it publishes. */
  readonly sites: number;

  /** The files of the one larger site it publishes, and copies. */
  readonly files: number;

  /** The visits of a page one after another. */
  readonly row: number;

  /** The visits of the page at once, after those. */
  readonly burst: number;

  /** The requests for a file no site holds, one after another, and as many again at once. */
  readonly missing: number;

  /** The listings of the sites, one after another. */
  readonly lists: number;
}

/** What a load does at the most. */
interface LoadPlan {
  /** The rows it makes the install's database write, the removal of its sites among them. */
  readonly rows: number;

  /** The writes and lists it asks the bucket for. */
  readonly bucket: number;

  /** The requests its one visitor sends inside a minute. */
  readonly visits: number;
}

/** How the requests of one step went. */
interface Went {
  /** How many were sent. */
  readonly asked: number;

  /** The milliseconds each took, or all of a burst together. */
  readonly ms: readonly number[];

  /** How many the install refused as it may. */
  readonly refused: number;

  /** What each other wrong answer was: its status alone. */
  readonly failed: readonly number[];
}

/** The sizes of the load a live run makes. */
export const LOAD_SIZES: LoadSizes = { sites: 5, files: 20, row: 30, burst: 50, missing: 10, lists: 5 };

/**
 * Say what a load of some sizes does at the most.
 *
 * @returns the rows written, the bucket's writes and lists, and the visits of its one visitor
 */
export function loadPlan(sizes: LoadSizes): LoadPlan {
  const visits = sizes.row + sizes.burst + 2 * sizes.missing;
  const made = sizes.sites + 2;

  return {
    rows: (sizes.sites + 1) * ROW_PRICES.site + visits * ROW_PRICES.visit + ROW_PRICES.copy + made * ROW_PRICES.removal,
    // A copy writes each file and lists twice, where the publish of the same files lists once.
    bucket: 2 * sizes.sites + (sizes.files + 1) + (sizes.files + 2) + made,
    visits,
  };
}

/** Why a load of a plan may not start, as the end of a sentence; `undefined` for one that may. */
function over(plan: LoadPlan): string | undefined {
  if (plan.rows > ROW_CEILINGS.load) return `would write ${plan.rows} rows, over its ceiling of ${ROW_CEILINGS.load}`;

  if (plan.bucket > CEILINGS.load) return `would ask the bucket for ${plan.bucket} writes and lists, over its ceiling of ${CEILINGS.load}`;

  return plan.visits > VISITOR_MINUTE ? `would send ${plan.visits} visits, over the ${VISITOR_MINUTE} one visitor's minute holds` : undefined;
}

/** Whether an answer is the install's own refusal of a visitor past its minute, in its own words. */
async function isRefusal(answer: Response): Promise<boolean> {
  return answer.status === REFUSAL.status && answer.headers.has(REFUSAL.header) && (await answer.text()).startsWith(REFUSAL.words);
}

/** Judge the answers of one step against the status it asks for. */
async function judged(answers: readonly Response[], status: number, ms: readonly number[]): Promise<Went> {
  const wrong = answers.filter((answer) => answer.status !== status);
  const refusals = await Promise.all(wrong.map(isRefusal));

  return { asked: answers.length, ms, refused: refusals.filter(Boolean).length, failed: wrong.filter((_answer, at) => refusals[at] !== true).map((answer) => answer.status) };
}

/** Visit an address so many times, one after another. */
async function inRow(bench: Bench, address: string, count: number, status: number): Promise<Went> {
  const answers: Response[] = [];
  const ms: number[] = [];
  for (let at = 0; at < count; at += 1) {
    const began = bench.now();
    answers.push(await bench.visit(address));
    ms.push(bench.now() - began);
  }

  return judged(answers, status, ms);
}

/** Visit an address so many times at once. */
async function atOnce(bench: Bench, address: string, count: number, status: number): Promise<Went> {
  const began = bench.now();
  const answers = await Promise.all(Array.from({ length: count }, () => bench.visit(address)));

  return judged(answers, status, [bench.now() - began]);
}

/** Time so many runs of one command, one after another; each must exit 0. */
async function timed<Result>(bench: Bench, count: number, command: (at: number) => Promise<Result>): Promise<{ readonly results: readonly Result[]; readonly ms: readonly number[] }> {
  const results: Result[] = [];
  const ms: number[] = [];
  for (let at = 0; at < count; at += 1) {
    const began = bench.now();
    results.push(await command(at));
    ms.push(bench.now() - began);
  }

  return { results, ms };
}

/** How long the steps of a list took, as a line says it: the average and the longest, in whole milliseconds. */
function took(ms: readonly number[]): string {
  return `mean ${Math.round(ms.reduce((sum, one) => sum + one, 0) / Math.max(1, ms.length))} ms, most ${Math.max(0, ...ms)} ms`;
}

/** Say how the visits of one step went, and fail where an answer was neither the one asked for nor the install's refusal. */
function sayVisits(bench: Bench, what: string, row: Went, burst: Went): void {
  bench.say(`load: ${what}: ${row.asked} in a row, ${took(row.ms)}; ${burst.asked} at once in ${burst.ms[0] ?? 0} ms; ${row.refused + burst.refused} refused`);
  expect({ what, failed: [...row.failed, ...burst.failed] }).toEqual({ what, failed: [] });
}

/** Publish one unlisted site of so many files through the CLI, named so the run's sweep removes it. */
async function publishFiles(bench: Bench, files: number): Promise<LiveSite> {
  const path = bench.folder("<p>a load page</p>");
  for (let at = 1; at < files; at += 1) writeFileSync(join(path, `file-${at}.txt`), `file ${at}\n`);

  const ran = await bench.cli("publish", path, "--name", `${bench.prefix}-load`, "--unlisted", "--expires", "1d");
  expect({ code: ran.code, refused: ran.met.refused }).toEqual({ code: 0, refused: undefined });

  return ran.value.site as unknown as LiveSite;
}

/** Run a load of some sizes on a bench: say its plan, and send nothing where the plan is over a ceiling. */
async function runLoad(bench: Bench, sizes: LoadSizes): Promise<void> {
  const plan = loadPlan(sizes);
  bench.say(`load: at most ${plan.rows} rows written of a ceiling of ${ROW_CEILINGS.load}, ${plan.bucket} bucket writes and lists of a ceiling of ${CEILINGS.load}, and ${plan.visits} visits of one visitor's ${VISITOR_MINUTE} a minute`);
  const refused = over(plan);
  if (refused !== undefined) throw new Error(`The load did not start: it ${refused}.`);

  const small = await timed(bench, sizes.sites, (at) => bench.publish({ access: "unlisted", text: `<p>load ${at}</p>` }));
  bench.say(`load: publish ${sizes.sites} sites of one page: ${took(small.ms)}`);
  const large = await timed(bench, 1, () => publishFiles(bench, sizes.files));
  bench.say(`load: publish a site of ${sizes.files} files: ${took(large.ms)}`);
  const [site] = large.results;
  if (site === undefined) throw new Error("the load published no site");

  await bench.pause(MINUTE_MS);
  sayVisits(bench, "open a page", await inRow(bench, site.url, sizes.row, 200), await atOnce(bench, site.url, sizes.burst, 200));
  const nothing = under(site.url, "nothing-here.html");
  sayVisits(bench, "ask for a file the site does not hold", await inRow(bench, nothing, sizes.missing, 404), await atOnce(bench, nothing, sizes.missing, 404));

  const lists = await timed(bench, sizes.lists, () => bench.cli("list"));
  bench.say(`load: list the sites: ${took(lists.ms)}`);
  const copies = await timed(bench, 1, () => bench.cli("duplicate", site.label));
  bench.say(`load: copy the site of ${sizes.files} files: ${took(copies.ms)}`);
  expect([...lists.results, ...copies.results].map((ran) => ({ code: ran.code, refused: ran.met.refused }))).toEqual(Array.from({ length: sizes.lists + 1 }, () => ({ code: 0, refused: undefined })));
}

/**
 * The load as a check of the live suite.
 *
 * @param sizes - how large it is; the sizes of a live run when left out
 * @returns one check, which needs a token: the run's sweep removes every site it made
 */
export function loadChecks(sizes: LoadSizes = LOAD_SIZES): readonly Check[] {
  return [{ id: "load", name: "a small load of publishes, visits in a row and at once, listings, and a copy is answered with no failure, inside the rows it said it would write", needs: ["token"], run: (bench) => runLoad(bench, sizes) }];
}
