// The name of an install's Workflow at Cloudflare. An account names each Workflow once, so the name holds the Worker's own: two installs in one account then hold two.

/** What follows the Worker's name. */
const SUFFIX = "-jobs";

/** The most characters Cloudflare takes as a Workflow's name. */
const MOST_LENGTH = 64;

/**
 * Name the Workflow of the Worker with a name.
 *
 * @param worker - the Worker's name, as its `WORKER_NAME` says it
 * @returns the Worker's name, cut so that the whole fits a Workflow's name, then `-jobs`
 */
export function workflowNameOf(worker: string): string {
  return `${worker.slice(0, MOST_LENGTH - SUFFIX.length)}${SUFFIX}`;
}
