// The reading of a job at Cloudflare runs against a local fake: the live check of a copy trusts its answer, and a state read wrong would pass a copy whose job failed, or fail one that ended, on a real run alone.

import { describe, expect, test } from "bun:test";

import { readJobRun } from "../../packages/providers/cloudflare/scripts/live/job-run";
import { withFake } from "../../packages/providers/cloudflare/tests/shared/install/support/fake-cloudflare";
import { refusal, reply } from "../../packages/providers/cloudflare/tests/shared/install/support/replies";

/** The account the fake holds. */
const ACCOUNT = "0".repeat(32);

/** The upload whose job is read. */
const UPLOAD = "k3f9x2ab71qzw0de";

describe("the job of an upload, read at a local fake of Cloudflare", () => {
  test.each([
    ["an instance whose every step ended is done", "complete", "done"],
    ["one that threw is failed", "errored", "failed"],
    ["one that was stopped is failed", "terminated", "failed"],
    ["one that waits its turn is running", "queued", "running"],
    ["one at a step is running", "running", "running"],
  ])("%s", async (_what, status, state) => {
    await withFake(
      () => reply({ status, step_count: 2 }),
      async (connection, asked) => {
        expect<unknown>(await readJobRun(connection, ACCOUNT, UPLOAD)).toEqual({ state, steps: 2 });
        // The instance is the upload's own, of the Workflow named after the test install's Worker.
        expect(asked.map((entry) => `${entry.method} ${entry.path}`)).toEqual([`GET /accounts/${ACCOUNT}/workflows/poplin-jobs/instances/${UPLOAD}`]);
      },
    );
  });

  // The message of a failed reading reaches a public log: it holds this file's words alone.
  test("a job Cloudflare does not hold is told in words that quote nothing Cloudflare said", async () => {
    await withFake(
      () => refusal(404, 10200, `no instance ${UPLOAD} of the account ${ACCOUNT}`),
      async (connection) => {
        expect(await readJobRun(connection, ACCOUNT, UPLOAD).catch((error: unknown) => String(error))).toBe("Error: the job at Cloudflare could not be read: refused");
      },
    );
  });
});
