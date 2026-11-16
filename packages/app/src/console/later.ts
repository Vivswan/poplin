// Work a request does not hold its answer for: a host that holds a request open past the answer lets it run on, and anywhere else it is done before the answer.

import type { Context } from "hono";

/** What a host holds a request open with: it is handed the work, and keeps the request alive until that settles. */
export type Later = (work: Promise<unknown>) => void;

/** What goes beside a request into the framework, and comes out again in every route of it. */
interface Beside {
  readonly later?: Later | undefined;
}

/**
 * Write a host's way to hold a request open as it goes beside the request into the framework.
 *
 * @param later - the host's way, `undefined` for a host with none
 */
export function holding(later: Later | undefined): Beside {
  return { later };
}

/**
 * Let work that has begun run on past the answer of a request.
 *
 * @param context - a request that came in with what `holding` wrote, or with nothing
 * @param work - work that rejects for nothing: what goes wrong in it is its own to settle
 * @returns once the work is handed over, on a host that holds the request open for it, and once the work is done anywhere else
 */
export async function runPastAnswer(context: Context, work: Promise<unknown>): Promise<void> {
  const beside: Beside | undefined = context.env;
  if (beside?.later === undefined) await work;
  else beside.later(work);
}
