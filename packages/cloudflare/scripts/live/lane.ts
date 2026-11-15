// Wait until no other run of the live workflow is queued or running, before the midnight reset takes its place in the lane.
//
// The lane holds one waiting job: a job that joins it while another waits takes that one's place. A reset that joined then would cancel the checks of the newest commit.
// It calls GitHub, and never Cloudflare. A lane that stays busy, or one GitHub does not tell of, ends the run red.

import { type Ask, askGitHub, liveRuns } from "./util";

/** How long the lane has to come free, and how often GitHub is asked, in milliseconds. */
const WAIT = { withinMs: 3_600_000, everyMs: 30_000 };

/** The two things asked outside the process. */
interface Tools {
  /** GitHub, for the runs of the workflow. */
  readonly ask: Ask;

  /** Lets a time pass, in milliseconds. */
  readonly pause: (ms: number) => Promise<void>;
}

/** How many runs of the checks have not ended. A midnight run is not counted: this one is one, another waits here itself, and its reset takes the place of no checks. */
async function busyRuns(env: Readonly<Record<string, string | undefined>>, ask: Ask): Promise<number> {
  const runs = await liveRuns(env, ask);

  return runs.filter((run) => run.event !== "schedule" && run.status !== "completed").length;
}

/**
 * Wait for the lane to come free, and tell the log.
 *
 * @param env - names the repository
 * @returns the exit code: 0 once no run of the checks is queued or running, 1 when the lane stayed busy or GitHub did not answer
 */
export async function awaitLane(env: Readonly<Record<string, string | undefined>>, tools: Tools = { ask: askGitHub, pause: Bun.sleep }): Promise<number> {
  try {
    // The lane is asked once more after the last pause, so a lane that came free in it is not called busy.
    for (let waited = 0; waited <= WAIT.withinMs; waited += WAIT.everyMs) {
      const busy = await busyRuns(env, tools.ask);
      if (busy === 0) {
        console.log("No other run of the live workflow is queued or running.");

        return 0;
      }

      if (waited === 0) console.log(`Waiting for ${busy} other run(s) of the live workflow to end.`);

      if (waited < WAIT.withinMs) await tools.pause(WAIT.everyMs);
    }
  } catch (error) {
    console.log(`::error::The reset did not run: the runs of the live workflow could not be read (${String(error).replace(/\p{Cc}/gu, " ")}).`);

    return 1;
  }

  console.log(`::error::The reset did not run: another run of the live workflow was queued or running for ${WAIT.withinMs / 60_000} minutes.`);

  return 1;
}

if (import.meta.main) process.exitCode = await awaitLane(process.env);
