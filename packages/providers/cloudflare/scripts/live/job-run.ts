// How one job of the test install went, read at Cloudflare with the key a live run holds: the instance of the Worker's Workflow that a copy's upload names, its state, and how many steps it ran.

import { BaseInstances } from "cloudflare/resources/workflows/instances/instances";

import { workflowNameOf } from "../../src/shared/jobs/workflow-name";
import { type Connection, callCloudflare } from "../../src/shared/install/client";
import { SCRIPT } from "./util";

/** The states of an instance that ended without doing its work. */
const FAILED: ReadonlySet<string> = new Set(["errored", "terminated"]);

/** A job as Cloudflare tells it: `done` once every step ended, `failed` for one that threw or was stopped, and `running` for any other state. */
export interface JobRun {
  readonly state: "done" | "running" | "failed";
  readonly steps: number;
}

/**
 * Read the job of one upload.
 *
 * @param upload - the upload's id, which is the instance's
 * @returns the job's state and its steps so far
 * @throws {Error} Cloudflare refused the reading, or holds no such instance; the message is one of this file's own, and holds nothing Cloudflare or the connection said
 */
export async function readJobRun(connection: Connection, accountId: string, upload: string): Promise<JobRun> {
  // A reading that ends in an exception is told in this file's words too: what was thrown may quote the request.
  const reading = callCloudflare(connection, (api) => new BaseInstances(api).get(upload, { account_id: accountId, workflow_name: workflowNameOf(SCRIPT) }));
  const read = await reading.catch(() => undefined);
  if (read === undefined) throw new Error("the job at Cloudflare could not be read: the reading failed");

  if (!read.ok) throw new Error(`the job at Cloudflare could not be read: ${read.failure}`);

  const { status, step_count: steps } = read.value;
  if (status === "complete") return { state: "done", steps };

  return { state: FAILED.has(status) ? "failed" : "running", steps };
}
