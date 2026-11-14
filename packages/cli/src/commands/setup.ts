// `poplin setup`: the install's own setup page, run from a terminal. The install checks and repairs its side at its provider; this command sends it the token and prints its rows.
//
//   POPLIN_SETUP_TOKEN  ->  POST <server>/setup/api/repair  ->  the rows, the steps only a person can do, and what is left
//
// The token is read from the environment alone: never from an argument, which a process list shows, and never saved.
// No redirect is followed, so the token goes to the address given and nowhere else.

import * as v from "valibot";

import { isServer } from "../local/login";
import { type Problem, problem } from "./problems";
import type { Io, Outcome, RequestOf } from "./records";
import { columns } from "./text";

/** The environment variable the token is read from. */
const TOKEN_VARIABLE = "POPLIN_SETUP_TOKEN";

/** How long a run may take: a repair makes every object in turn, so two minutes. */
const RUN_TIMEOUT_MS = 120_000;

/** What stands where the token would have been printed, should an install ever hand it back. */
const HIDDEN = "[token]";

/** The states a repair has still to change, or could not. */
const UNFINISHED: ReadonlySet<string> = new Set(["missing", "differs", "failed", "not-run"]);

/** The install's answer to a run that read its side: a row per object, and the steps only a person can do. */
const READING = v.object({
  ok: v.literal(true),
  rows: v.array(v.object({ object: v.string(), state: v.string(), detail: v.string() })),
  steps: v.array(v.object({ text: v.string(), address: v.string() })),
});

/** The install's answer to a run it refused. */
const REFUSED = v.object({ ok: v.literal(false), refusal: v.string() });

/** What each refusal of the install is, as a problem of this command. */
const REFUSALS: Readonly<Record<string, () => Problem>> = {
  token: () => problem("setup_token_refused"),
  unreachable: () => problem("setup_provider_silent"),
  not_set_up: () => problem("not_set_up"),
  too_many_tries: () => problem("too_many_requests"),
  no_domain: () => problem("setup_no_domain"),
  bad_domain: () => problem("setup_bad_domain"),
  bad_login: () => problem("setup_bad_login"),
  allowance_spent: () => problem("allowance_spent"),
};

/** The rows and the steps of a run that read the install's side. */
type Reading = v.InferOutput<typeof READING>;

function refused(said: Problem): Outcome {
  return { ok: false, problem: said };
}

/** The answer of an install whose setup page is shut, or of an address that is no install's: both are a 404 that says nothing. */
function unanswered(status: number): Outcome {
  if (status === 404) return refused(problem("setup_closed"));

  return refused(problem("unexpected_answer", `status ${status}`));
}

function summary(run: "check" | "repair", waiting: number): string {
  if (waiting > 0) return run === "check" ? `${waiting} to repair` : `${waiting} not done`;

  return run === "check" ? "nothing to repair" : "the install's side is as it should be";
}

/** Word a reading for a person: a row per object, then each step only a person can do with its address on a line of its own. */
function shown(run: "check" | "repair", reading: Reading, token: string): Outcome {
  const safe = (text: string): string => text.replaceAll(token, HIDDEN);
  const rows = reading.rows.map((row) => ({ object: safe(row.object), state: safe(row.state), detail: safe(row.detail) }));
  const steps = reading.steps.map((step) => ({ text: safe(step.text), address: safe(step.address) }));
  const waiting = rows.filter((row) => UNFINISHED.has(row.state)).length;
  const lines = [...columns(rows.map((row) => [row.state, row.object, row.detail])), ...steps.flatMap((step) => [step.text, step.address]), summary(run, waiting)];
  const outcome: Outcome = { ok: true, value: { run, rows, steps }, lines };

  return waiting > 0 ? { ...outcome, found: "failed" } : outcome;
}

/**
 * Run the setup of the install at `--server`.
 *
 * It makes no install: the install must already answer at the address. It works only until somebody has logged in to the install; after that the dashboard's Domain tab does the same.
 * An install with nothing set takes its domain and its first login from `--domain` and `--login`; one that has them ignores both.
 *
 * @returns the install's rows, worded for a person and kept whole for `--json`; with anything left to repair the command exits as a failure. The token is in no line and no value
 */
export async function runSetup(request: RequestOf<"setup">, io: Io): Promise<Outcome> {
  if (request.server === undefined) return refused(problem("no_setup_server"));

  if (!isServer(request.server)) return refused(problem("bad_server"));

  const token = io.machine.env[TOKEN_VARIABLE] ?? "";
  if (token === "") return refused(problem("no_setup_token"));

  const run = request.check ? "check" : "repair";
  const signal = AbortSignal.any([AbortSignal.timeout(io.timeoutMs ?? RUN_TIMEOUT_MS), io.stopped]);
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, domain: request.domain, login: request.login }), redirect: "manual" as const, signal };
  const answer = await io.fetch(`${request.server}/setup/api/${run}`, init).catch(() => undefined);
  const body: unknown = await answer?.json().catch(() => undefined);
  if (body === undefined && io.stopped.aborted) return refused(problem("stopped", undefined, "the install may have had the request all the same; poplin setup --check shows what is left"));

  if (answer === undefined) return refused(problem("unreachable", undefined, "check the address and the network"));

  const reading = v.safeParse(READING, body);
  if (reading.success && answer.ok) return shown(run, reading.output, token);

  const refusal = v.safeParse(REFUSED, body);
  if (!refusal.success || answer.ok) return unanswered(answer.status);

  const said = Object.hasOwn(REFUSALS, refusal.output.refusal) ? REFUSALS[refusal.output.refusal] : undefined;

  return refused(said === undefined ? problem("unexpected_answer", `status ${answer.status}`) : said());
}
