// D1's daily allowance on the Free plan, read out of the error D1 rejects a query with once it is used up.
//
//   D1_ERROR: Your account has exceeded D1's free tier daily row read limit. ...    ->  reading
//   D1_ERROR: Your account has exceeded D1's free tier daily row write limit. ...   ->  writing

import { AllowanceSpent } from "@poplin/core/src/database/driver";

/** The part of D1's sentence that names the limit, with what follows it left open: D1 goes on to say how to raise it. */
const DAILY_LIMIT = /exceeded D1's free tier daily row (read|write) limit/;

/** What each limit of D1 stops. */
const SPENT = { read: "reading", write: "writing" } as const;

/** The message of an error, and of the error it was caused by: older runtimes put D1's sentence in the cause. */
function wordsOf(error: unknown): string {
  if (!(error instanceof Error)) return "";

  return `${error.message}\n${wordsOf(error.cause)}`;
}

/**
 * Read a failure of D1 as the day's allowance used up.
 *
 * @param error - whatever a query of D1 rejected with
 * @returns the refusal core knows, with D1's own error as its cause; `undefined` for any other failure
 */
export function allowanceSpent(error: unknown): AllowanceSpent | undefined {
  const limit = DAILY_LIMIT.exec(wordsOf(error))?.[1];
  if (limit !== "read" && limit !== "write") return undefined;

  return new AllowanceSpent(SPENT[limit], { cause: error });
}
