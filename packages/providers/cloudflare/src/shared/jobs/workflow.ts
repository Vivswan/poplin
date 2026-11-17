// The Workflow that runs the install's jobs: one instance a job, one step a round.
//
//   a step            one round of the job, as one invocation of the Worker: it is held to what one request may ask of the database and of the bucket
//   a step that fails Cloudflare runs it again, five times, each after a longer wait; a round finds what is left from the records and the bucket, so a second run copies only the files still missing
//   after the fifth   one more step gives the job up: what it was making is removed, and the failure noted as a problem of the install
//
// Cloudflare keeps what a step throws, with the instance. A round's failure is therefore thrown as its fault: fixed words and places in the code, and no message, which may hold a site's id.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { meterNoted } from "@poplin/core/src/actions/install/problems";
import type { Install } from "@poplin/core/src/actions/records";
import { JOB, type Job } from "@poplin/core/src/jobs/jobs";
import { failJob, runJob } from "@poplin/core/src/jobs/run-job";
import * as v from "valibot";

import type { Bindings } from "../worker/bindings";
import { faultOf, logFault } from "../worker/fault";
import type { Started } from "../worker/start";

/** The most rounds one job is run: under the 1,024 steps Cloudflare gives an instance, with the step that gives a job up to spare. */
const MOST_ROUNDS = 1000;

/** How a step that throws is run again: five times, the first after ten seconds and each later one after twice the wait. */
const RETRY = { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" } as const;

/** What a round that failed is thrown as. */
const ROUND_FAILED = "a round of a job failed";

/** What a job that could not be given up is thrown as. */
const GIVE_UP_FAILED = "a job that failed was not given up";

/**
 * Do one step's work on the install, with every listing of the bucket counted against the day as a request's are.
 *
 * @param what - what the step is thrown as when it fails, in fixed words
 * @throws {Error} the fault of whatever the work threw, after it is written to the log; or that the install did not start
 */
async function onInstall<Result>(started: Started, what: string, work: (install: Install) => Promise<Result>): Promise<Result> {
  if (!started.ok) throw new Error(`poplin: ${what}: the install did not start (${started.failure.kind})`);

  const meter = meterNoted(started.instance.install);

  try {
    return await work({ ...started.instance.install, store: meter.store });
  } catch (error) {
    logFault(what, error);

    throw faultOf(what, error);
  } finally {
    await meter.settle().catch((error: unknown) => logFault("the day's count of writes to the bucket was not written", error));
  }
}

/**
 * Run one round of a job, as one step does.
 *
 * @returns `more` while another round is needed, and `done` once the job has ended
 * @throws {Error} the round's fault: Cloudflare runs the step again
 */
export function roundStep(started: Started, job: Job): Promise<"more" | "done"> {
  return onInstall(started, ROUND_FAILED, (install) => runJob(install, job));
}

/**
 * Give up a job whose round failed for good, as the last step of its instance does.
 *
 * @param failure - what the round's last try threw
 * @throws {Error} the fault of a job that could not be given up: what it made stays until the sweep removes it
 */
export function giveUpStep(started: Started, job: Job, failure: unknown): Promise<void> {
  return onInstall(started, GIVE_UP_FAILED, (install) => failJob(install, job, failure));
}

/**
 * Make the Workflow class of one Worker.
 *
 * @param starting - starts the Worker's instance, or answers the one that is started
 * @returns the class Cloudflare makes an instance of for each job. Its `run` ends once the job says it is done, and throws for a job that failed or that did not end in its rounds, after it gave the job up
 */
export function jobsEntrypoint(starting: (env: Bindings) => Promise<Started>): new (ctx: ExecutionContext, env: Bindings) => WorkflowEntrypoint<Bindings, unknown> {
  return class extends WorkflowEntrypoint<Bindings, unknown> {
    override async run(event: Readonly<WorkflowEvent<unknown>>, step: WorkflowStep): Promise<void> {
      const parsed = v.safeParse(JOB, event.payload);
      if (!parsed.success) throw new NonRetryableError("poplin: the instance holds no job");

      const job: Job = parsed.output;
      const giveUp = async (failure: unknown): Promise<void> => step.do("give up", RETRY, async () => giveUpStep(await starting(this.env), job, failure));

      for (let round = 1; round <= MOST_ROUNDS; round += 1) {
        const went = await step.do(`round ${round}`, RETRY, async () => roundStep(await starting(this.env), job)).catch(async (error: unknown) => {
          await giveUp(error);

          throw error;
        });
        if (went === "done") return;
      }

      await giveUp(new Error("the job did not end in its rounds"));

      throw new NonRetryableError("poplin: the job did not end in its rounds");
    }
  };
}
