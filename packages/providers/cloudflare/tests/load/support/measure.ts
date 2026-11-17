// Measures one scenario at one size: an install emptied and filled, then one request, a row of the same request, and a burst of it at once, every call to the database and the bucket counted by the budget's tally.
//
//   turn 0                    the first request, on an instance whose settings are a minute old: what the tables state
//   turns 1 to `row`          one after another: what one costs on average, and how many failed
//   the next `burst` turns    all at once: how many failed, and how many were refused as the scenario says a request may be

import { reset } from "cloudflare:test";
import { type Axis, type Fill, fillOf, type Profile } from "../../../load/profiles";
import type { Cost, LoadLine } from "../../../load/report";
import { get, type Measured, type Stage, stageOf } from "../../shared/worker/support/budget-stage";
import { emptyTally, type Tally, talliedBindings } from "../../shared/worker/support/call-tally";
import { ADMIN, awayFromMinuteEnd, instance } from "../../shared/worker/support/install";

/** How far the clock moves before the first request: past the minute a request trusts the settings for. */
const SETTINGS_LAPSE_MS = 61_000;

/** Reads an answer's bytes as text. */
const DECODER = new TextDecoder();

/** How much of an answer a failure quotes. */
const QUOTED = 200;

/** What a turn answers, as far as it is read; `undefined` for a scheduled run, which answers nothing. */
type Answered = Response | { readonly status: number } | undefined;

/** One request of a scenario: `turn` counts from 0, so a request that changes something takes a thing of its own. */
export type Turn = (measured: Measured, turn: number) => Promise<Answered>;

/** One thing the product does, measured across one thing of a fill. */
export interface Scenario {
  /** What is asked, as a report names it. */
  readonly name: string;

  /** The thing of the fill the scenario is measured across. */
  readonly axis: Axis;

  /** Whether the cost should be the same at every size. */
  readonly flat: boolean;

  /** The status a request that was done answers; `undefined` for a scheduled run. */
  readonly status: number | undefined;

  /** The refusal a request of a row or a burst may meet in place of that status: its status, words its body holds, and how many requests are done before the first is refused. Left out, every request must be done. */
  readonly refusal?: { readonly status: number; readonly words: string; readonly after: number };

  /** Set for a request anyone may send, with no login. */
  readonly open?: true;

  /** Why a cost that should be flat grows today, in one line. A scenario whose cost is flat carries none. */
  readonly known?: string;

  /** How many turns one fill has room for; left out, as many as are asked. */
  readonly turns?: (fill: Fill) => number;

  /** Fill the install and answer the request to measure. */
  readonly arrange: (stage: Stage, fill: Fill) => Promise<Turn>;
}

declare module "vitest" {
  interface TaskMeta {
    /** What a scenario measured at each size it got to. */
    load?: LoadLine[];
  }
}

/** What a tally holds, as a cost. */
function costOf(tally: Tally, ms: number, requests = 1): Cost {
  const bucket = tally.gets + tally.heads + tally.puts + tally.lists + tally.deletes;

  return { queries: tally.queries / requests, read: tally.read / requests, written: tally.written / requests, bucket: bucket / requests, ms: ms / requests };
}

/** Take one turn, read its answer to the end, and say how it went: done, refused as the scenario lets it be, or failed, with what it answered. */
async function taken(scenario: Scenario, turn: Turn, measured: Measured, at: number): Promise<{ readonly went: "done" | "refused" | "failed"; readonly said: string }> {
  const answer = await turn(measured, at);
  // A file's bytes are read as they are, and as text only to be quoted.
  const text = answer instanceof Response ? DECODER.decode(await answer.arrayBuffer()) : "";
  const said = `${answer?.status}: ${text.slice(0, QUOTED)}`;
  if (answer?.status === scenario.status) return { went: "done", said };

  const refused = scenario.refusal !== undefined && answer?.status === scenario.refusal.status && text.includes(scenario.refusal.words);

  return { went: refused ? "refused" : "failed", said };
}

/** Hold one request of a row to its turn: under a limit, each turn before the limit's cutoff is done and each one from it on is refused. A request that went the other way failed. */
function inTurn(scenario: Scenario, at: number, went: Awaited<ReturnType<typeof taken>>): Awaited<ReturnType<typeof taken>> {
  if (scenario.refusal === undefined || went.went === "failed") return went;

  const due = at < scenario.refusal.after ? "done" : "refused";

  return went.went === due ? went : { went: "failed", said: `turn ${at} was ${went.went} where the limit has it ${due}: ${went.said}` };
}

/**
 * Measure one scenario at one size of a profile, on an install emptied before it.
 *
 * @returns what the first request cost, and how the row and the burst after it went
 * @throws {Error} the first request was not done: the scenario does not work at the size
 */
export async function measureAt(scenario: Scenario, profile: Profile, size: number): Promise<LoadLine> {
  await reset();
  const stage = await stageOf();
  const fill = fillOf(profile, scenario.axis, size);
  // A limit of a minute counts by the wall clock: what a scenario spends of one as it is arranged, and its turns after, all fall in one minute.
  if (scenario.refusal !== undefined) await awayFromMinuteEnd();

  const turn = await scenario.arrange(stage, fill);
  const tally = emptyTally();
  const secrets = { ...(stage.keptKey === undefined ? {} : { KEPT_KEY: stage.keptKey }), ...(stage.uploadKey === undefined ? {} : { UPLOAD_KEY: stage.uploadKey }) };
  const bindings = { ...talliedBindings(tally), ...secrets, ...(stage.jobs === undefined ? {} : { JOBS: stage.jobs }) };
  const measured: Measured = { worker: instance(stage.w, stage.outside.cloudflare, stage.outside.latest), bindings, w: stage.w };
  const room = Math.max(1, scenario.turns?.(fill) ?? Number.POSITIVE_INFINITY);
  // A fill with room for few turns gives half of them to the row, so a burst is still asked.
  const row = Math.min(profile.row, Math.ceil((room - 1) / 2));
  const burst = Math.min(profile.burst, room - 1 - row);

  await get(measured, `${ADMIN}/api/whoami`);
  stage.w.clock.now += SETTINGS_LAPSE_MS;
  Object.assign(tally, emptyTally());

  let began = Date.now();
  const first = await taken(scenario, turn, measured, 0);
  const once = costOf(tally, Date.now() - began);
  if (first.went !== "done") throw new Error(`"${scenario.name}" at ${size} ${scenario.axis} answered ${first.said}`);

  Object.assign(tally, emptyTally());
  began = Date.now();
  const inRow: Awaited<ReturnType<typeof taken>>[] = [];
  for (let at = 1; at <= row; at += 1) inRow.push(inTurn(scenario, at, await taken(scenario, turn, measured, at)));

  const mean = costOf(tally, Date.now() - began, Math.max(1, row));

  began = Date.now();
  const together = await Promise.all(Array.from({ length: burst }, (_request, at) => taken(scenario, turn, measured, 1 + row + at)));
  const counted = (all: typeof together, went: string): number => all.filter((one) => one.went === went).length;
  const failure = [...inRow, ...together].find((one) => one.went === "failed")?.said;

  return {
    scenario: scenario.name,
    axis: scenario.axis,
    size,
    flat: scenario.flat,
    run: scenario.status === undefined,
    open: scenario.open === true,
    once,
    row: { asked: row, failed: counted(inRow, "failed"), refused: counted(inRow, "refused"), mean },
    burst: { asked: burst, failed: counted(together, "failed"), refused: counted(together, "refused"), ms: Date.now() - began },
    ...(failure === undefined ? {} : { failure }),
  };
}
