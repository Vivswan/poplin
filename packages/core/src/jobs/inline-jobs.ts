// The jobs of a host with no background work of its own: nothing is started, and each ask after a job runs one round of it.

import type { Jobs } from "./jobs";

/** Jobs that are run by whoever asks after them. */
export const inlineJobs: Jobs = { background: false, start: async () => {}, stop: async () => {} };
