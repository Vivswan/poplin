// The door to work that goes on after the request that began it has ended: a job is one bounded round, run again until it says it is done.
//
//   a host with background work of its own   runs the rounds itself, each as an entry of its own: whoever asks after a job is told how far the records say it is
//   any other host                           runs none: whoever asks after a job runs one round with each ask
//
// What a job has done is read from the records its rounds write, and never from whoever runs them.

import * as v from "valibot";

import { UPLOAD_ID } from "../records/upload";

/** A job as it is handed to whoever runs it: the copy of a site, by the upload that holds it. It names no person. */
export const JOB = v.object({ kind: v.literal("copy"), upload: UPLOAD_ID });

/** One job. */
export type Job = Readonly<v.InferOutput<typeof JOB>>;

/** What starts and stops the jobs of one install. */
export interface Jobs {
  /** Whether a started job is run with nobody asking. Where it is not, each ask after the job runs one round of it. */
  readonly background: boolean;

  /** Begin running a job's rounds, where the host runs them. It throws when the host did not take the job. */
  readonly start: (job: Job) => Promise<void>;

  /** Stop running a job's rounds, to spare the ones that would find its record given up. It changes no record and never throws. */
  readonly stop: (job: Job) => Promise<void>;
}
