// How an install command goes on when Cloudflare asks it to wait (429): it waits as long as the answer names, says so, and makes the call again.
//
//   Retry-After: 20   -> wait 20 s, call again
//   no Retry-After    -> wait 1 s, then 2, 4, .. each time the same call is asked to wait again
//   one wait          -> 60 s at most
//   one call          -> 300 s of waiting at most, then its last answer stands
//
// Cloudflare counts the calls of an account in windows of five minutes, so a call that waited five has seen a whole window pass.

import type { Reach } from "@poplin/core/src/install/installer";
import pRetry from "p-retry";
import type { CloudflareFailure, CloudflareResult, Connection } from "../client";

/** The waits of one call, in milliseconds: the shortest and the first where the answer names none, the longest single one, and all of them together. */
const WAITS = { firstMs: 1000, singleMs: 60_000, totalMs: 300_000 } as const;

/** The milliseconds of a second, which the line a person reads counts in. */
const MS_PER_SECOND = 1000;

/** What a row says of a call that was still asked to wait after every wait. */
export const OUTLASTED = `Cloudflare asked to wait for more than ${WAITS.totalMs / MS_PER_SECOND / 60} minutes`;

/** An answer that asked to wait. */
type Limited = Extract<CloudflareFailure, { readonly failure: "rate-limited" }>;

/** The answer that asked to wait, as what a try throws to be made again. */
class AskedToWait extends Error {
  readonly failure: Limited;

  constructor(failure: Limited) {
    super("Cloudflare asked to wait");
    this.failure = failure;
  }
}

/** How long the next wait is: what the answer named, or twice the wait before; never under a second, over a minute, or over what is left of all the waits. */
function waitOf(failure: Limited, tries: number, left: number): number {
  const asked = failure.afterMs ?? WAITS.firstMs * 2 ** (tries - 1);

  return Math.min(Math.max(asked, WAITS.firstMs), WAITS.singleMs, left);
}

/**
 * Make the rider of an install command's connection.
 *
 * @param sleep - waits on the command's clock, and shows the line it is given; one that throws, as one the person stopped does, ends the call with that error
 * @returns runs a call, and again after each wait while its answer asks to wait; once the waits of one call are spent, that answer is the result.
 *   Once a wait threw, every later call throws the same and sends nothing: a caller that takes any error of one call for that call's failure cannot go on past a command that was stopped
 */
export function riderOf(sleep: Reach["sleep"]): NonNullable<Connection["ride"]> {
  const stopped: { by?: { readonly error: unknown } } = {};
  const rest: Reach["sleep"] = async (milliseconds, why) => {
    try {
      await sleep(milliseconds, why);
    } catch (error) {
      stopped.by = { error };

      throw error;
    }
  };

  return async <Value>(call: () => Promise<CloudflareResult<Value>>): Promise<CloudflareResult<Value>> => {
    if (stopped.by !== undefined) throw stopped.by.error;

    const spent = { ms: 0 };
    const attempt = async (): Promise<CloudflareResult<Value>> => {
      const result = await call();
      if (!result.ok && result.failure === "rate-limited") throw new AskedToWait(result);

      return result;
    };
    const again = async ({ error, attemptNumber }: { readonly error: Error; readonly attemptNumber: number }): Promise<boolean> => {
      if (!(error instanceof AskedToWait) || spent.ms >= WAITS.totalMs) return false;

      const wait = waitOf(error.failure, attemptNumber, WAITS.totalMs - spent.ms);
      spent.ms += wait;
      await rest(wait,`Cloudflare asked to wait. Retrying in ${Math.ceil(wait / MS_PER_SECOND)} s`);

      return true;
    };

    try {
      // The waits are on the command's clock: the library waits none.
      return await pRetry(attempt, { retries: Number.POSITIVE_INFINITY, minTimeout: 0, maxTimeout: 0, shouldRetry: again });
    } catch (error) {
      if (error instanceof AskedToWait) return error.failure;

      throw error;
    }
  };
}
