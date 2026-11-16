// Whether a new install answers yet: the command asks its address until it does, since a new name and its certificate can take minutes to be known.
//
//   GET <address>/api/whoami -> 401    the install is up, and takes nobody who is not logged in
//   anything else, or no answer         asked again after 5 seconds, until 5 minutes have gone by

import pRetry from "p-retry";

import type { InstallEnds } from "./records";

/** The path asked, which an install that is up answers for everybody. */
const PATH = "/api/whoami";

/** The status an install that is up answers a request with no login with. */
const UP = 401;

/** How long the command rests between two questions, in milliseconds: 5 seconds. */
const REST_MS = 5000;

/** How long the wait lasts at most, in milliseconds: 5 minutes. */
const LIMIT_MS = 300_000;

/** How long one question may take, in milliseconds: 10 seconds. */
const QUESTION_MS = 10_000;

/** How often the address is asked at most: as often as rests fit into the wait. */
const TRIES = LIMIT_MS / REST_MS;

/** One question that got another answer than the one of an install that is up, or none. */
class Silent extends Error {}

/**
 * Ask a new install's address until the install answers there.
 *
 * The rests are on the caller's clock, through `ends.sleep`, and the 5 minutes on `ends.reach.now`: the library waits none. A sleep that throws, as one the person stopped does, ends the wait with that error.
 *
 * @param address - the origin of the install's dashboard
 * @returns whether the install answered within 5 minutes
 */
export async function installAnswers(address: string, ends: Pick<InstallEnds, "reach" | "sleep">): Promise<boolean> {
  const started = ends.reach.now();
  const ask = async (): Promise<void> => {
    // A question ends with the wait at the latest, so no answer is taken after the 5 minutes.
    const left = Math.max(1, LIMIT_MS - (ends.reach.now() - started));
    const answer = await ends.reach.fetch(`${address}${PATH}`, { redirect: "manual", signal: AbortSignal.timeout(Math.min(QUESTION_MS, left)) }).catch(() => undefined);
    await answer?.body?.cancel().catch(() => undefined);

    if (answer?.status !== UP) throw new Silent();
  };

  // Rest, then ask again, while another rest still fits into the 5 minutes.
  const again = async (): Promise<boolean> => {
    if (ends.reach.now() - started + REST_MS >= LIMIT_MS) return false;

    await ends.sleep(REST_MS);

    return true;
  };

  try {
    await pRetry(ask, { retries: TRIES - 1, minTimeout: 0, factor: 1, shouldRetry: again });
  } catch (error) {
    if (error instanceof Silent) return false;

    throw error;
  }

  return true;
}
