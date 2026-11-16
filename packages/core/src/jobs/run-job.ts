// What a host calls to run a job: one round, and the end of a job whose round kept failing.

import { continueCopy, failCopy } from "../actions/duplicate";
import type { Install } from "../actions/records";
import type { Job } from "./jobs";

/**
 * Give up a job whose round failed for good: what it was making is removed, and the failure noted as a problem of the install.
 *
 * @param failure - what the last try of the round threw
 * @throws {Error} the store or the database failed
 */
export async function failJob(install: Install, job: Job, failure: unknown): Promise<void> {
  await failCopy(install, job.upload, failure);
}

/**
 * Run one round of a job. A round is safe to run twice: it finds what is left to do from the records and the store each time.
 *
 * @returns `more` while another round is needed, and `done` once the job is finished, was given up, or is gone
 * @throws {Error} the store or the database failed: the round may be run again
 */
export async function runJob(install: Install, job: Job): Promise<"more" | "done"> {
  return continueCopy(install, job.upload);
}
