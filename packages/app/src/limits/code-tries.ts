// How often one visitor may try a login's code: every page that looks a code up or decides a login counts against the same minute.

import type { Counters } from "./limits";

/** The most times a minute one visitor may look a login's code up or decide one: a person needs two, and a guesser gets no more. */
const CODES_PER_MINUTE = 20;

/** What a counter that cannot answer is taken to say: the minute is full, so a try at a code is refused. */
const UNCOUNTED = { ok: false } as const;

/** What the tries at a login's code are counted with. */
export interface CodeTries {
  /** Where the tries are counted, a minute at a time. */
  readonly counters: Pick<Counters, "takeMinute">;

  /** The key one visitor's tries are counted by: `visitorKey` of the address the host itself saw. */
  readonly visitorOf: (request: Request) => Promise<string>;
}

/**
 * Count one try at a login's code against the asking visitor's minute.
 *
 * @param now - the clock, in milliseconds since the epoch, read once the visitor is known
 * @returns whether the try fits the minute; `false` too when the counter cannot answer
 */
export async function takesCode(tries: CodeTries, request: Request, now: () => number): Promise<boolean> {
  const take = async (): Promise<{ readonly ok: boolean }> =>
    tries.counters.takeMinute({ scope: "visitor", key: `login-code:${await tries.visitorOf(request)}`, limit: CODES_PER_MINUTE }, now());

  return (await take().catch(() => UNCOUNTED)).ok;
}
