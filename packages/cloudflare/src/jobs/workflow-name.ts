// The name of an install's Workflow at Cloudflare. An account names each Workflow once, so the name holds the Worker's own: two installs in one account then hold two.

import { INSTALL_OBJECTS } from "../zone/install-objects";

/** What follows the Worker's name. */
const SUFFIX = INSTALL_OBJECTS.jobsSuffix;

/** The most characters Cloudflare takes as a Workflow's name. */
const MOST_LENGTH = INSTALL_OBJECTS.jobsNameLength;

/**
 * Name the Workflow of the Worker with a name.
 *
 * @param worker - the Worker's name, as its `WORKER_NAME` says it
 * @returns the Worker's name, cut so that the whole fits a Workflow's name, then `-jobs`
 */
export function workflowNameOf(worker: string): string {
  return `${worker.slice(0, MOST_LENGTH - SUFFIX.length)}${SUFFIX}`;
}
