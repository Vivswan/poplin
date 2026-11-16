// The install's jobs on Cloudflare: each job is one instance of the Worker's Workflow, named by the upload the job is about.
//
//   JOBS bound     a started job is run by Cloudflare, a round a step, with nobody asking
//   JOBS absent    nothing is started: each ask after a job runs one round, as on a host with no background work
//
// A Worker deployed by the OpenTofu module, or by a build from before the binding, has none until its next deploy.

import { inlineJobs } from "@poplin/core/src/jobs/inline-jobs";
import type { Job, Jobs } from "@poplin/core/src/jobs/jobs";

/**
 * Make the jobs of one install.
 *
 * @param binding - the Worker's Workflow, where it has one
 * @returns jobs that Cloudflare runs, or with no binding the jobs that whoever asks runs. A second start of one job throws, as the instance's id is taken
 */
export function workflowJobs(binding: Workflow<Job> | undefined): Jobs {
  if (binding === undefined) return inlineJobs;

  return {
    background: true,
    start: async (job) => void (await binding.create({ id: job.upload, params: job })),
    // An instance that has ended, or that never was, refuses to be terminated: there is nothing left to stop.
    stop: async (job) => {
      await binding
        .get(job.upload)
        .then((instance) => instance.terminate())
        .catch(() => undefined);
    },
  };
}
