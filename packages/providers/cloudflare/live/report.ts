// Runs a check and says what it came to; writes the outcomes as the table a person reads after a run.

import { type Bench, type Check, type Missing, type Outcome, Skip } from "./records";

/** What the table calls each result. */
const RESULT_WORDS: Readonly<Record<Outcome["result"], string>> = { passed: "passed", skipped: "skipped", failed: "FAILED" };

/** The first reason a check cannot run, or `undefined` for one that can. */
function lacking(check: Check, missing: Missing): string | undefined {
  return check.needs.map((need) => missing[need]).find((reason) => reason !== undefined);
}

/**
 * Run one check.
 *
 * @param report - told of the failure of a check that ran and found the install wrong
 * @returns `skipped` with the reason for a check the install cannot run, and never a rejection
 */
export async function runCheck(bench: Bench, check: Check, report: (error: unknown) => void = () => undefined): Promise<Outcome> {
  const { id, name } = check;
  const reason = lacking(check, bench.missing);
  if (reason !== undefined) return { id, name, result: "skipped", reason };

  try {
    await check.run(bench);
  } catch (error) {
    if (error instanceof Skip) return { id, name, result: "skipped", reason: error.message };

    report(error);

    return { id, name, result: "failed" };
  }

  return { id, name, result: "passed" };
}

/**
 * Write the outcomes as a Markdown table.
 *
 * @returns one row a check: its id, what it checks, its result, and why it was skipped; no row holds anything an install answered
 */
export function outcomeTable(outcomes: readonly Outcome[]): string {
  const rows = outcomes.map(
    (outcome) => `| ${outcome.id} | ${outcome.name} | ${RESULT_WORDS[outcome.result]} | ${outcome.result === "skipped" ? outcome.reason : ""} |`,
  );

  return ["| Check | What | Result | Skipped: needs |", "| --- | --- | --- | --- |", ...rows, ""].join("\n");
}
