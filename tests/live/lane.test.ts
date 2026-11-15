// The wait before the midnight reset runs against a fake of GitHub, and the workflow is read beside it.
// A reset that joined the lane while the checks of the newest commit waited there once took their place, and that commit was never checked.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { awaitLane } from "../../packages/cloudflare/scripts/live/lane";
import { catchStep } from "./support/step";

/** The workflow that runs the wait. */
const WORKFLOW = Bun.YAML.parse(readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "live-checks.yml"), "utf8")) as Workflow;

/** The id of the run that waits. */
const THIS_RUN = 99;

/** A workflow, as far as a test reads it. */
interface Workflow {
  readonly jobs: Readonly<Record<string, Job>>;
}

/** One job of a workflow, as far as a test reads it. */
interface Job {
  readonly needs?: string | readonly string[];
  readonly concurrency?: { readonly group: string };
  readonly steps: readonly { readonly run?: string; readonly env?: Readonly<Record<string, string>> }[];
}

/** What GitHub tells of the other runs each time it is asked, the last answer again after that; then the exit code, how often the wait paused, and the last line. */
type Case = readonly [what: string, answers: readonly (readonly string[] | "refuses")[], code: number, pauses: number, last: string];

const CASES: readonly Case[] = [
  ["a lane with no other run is free at once", [[]], 0, 0, "No other run of the live workflow is queued or running."],
  ["runs that have ended do not hold the lane", [["completed", "completed"]], 0, 0, "No other run of the live workflow is queued or running."],
  [
    "a run that runs and one that waits behind it hold the reset back until both have ended",
    [["in_progress", "pending"], ["in_progress"], ["completed"]],
    0,
    2,
    "No other run of the live workflow is queued or running.",
  ],
  ["a run that waits for a runner holds the lane", [["queued"], []], 0, 1, "No other run of the live workflow is queued or running."],
  ["another midnight run, which waits here too, does not hold the lane", [["midnight in_progress"]], 0, 0, "No other run of the live workflow is queued or running."],
  ["a lane that comes free in the last pause of the hour is free", [...Array.from({ length: 120 }, () => ["in_progress"]), []], 0, 120, "No other run of the live workflow is queued or running."],
  [
    "a lane that never comes free ends red, with no reset",
    [["in_progress"]],
    1,
    120,
    "::error::The reset did not run: another run of the live workflow was queued or running for 60 minutes.",
  ],
  ["a GitHub that refuses ends red, with no reset", ["refuses"], 1, 0, "::error::The reset did not run: the runs of the live workflow could not be read (Error: HTTP 403: Resource not accessible)."],
];

describe("the wait before the midnight reset", () => {
  test.each(CASES)("%s", async (_what, answers, code, pauses, last) => {
    using step = catchStep();
    let asked = 0;
    let paused = 0;

    const ask = async (): Promise<unknown> => {
      const answer = answers[Math.min(asked, answers.length - 1)] ?? [];
      asked += 1;
      if (answer === "refuses") throw new Error("HTTP 403: Resource not accessible");

      const others = answer.map((status, index) => ({ id: index + 1, status: status.replace("midnight ", ""), event: status.startsWith("midnight ") ? "schedule" : "workflow_run" }));
      // The run that waits is itself in progress, and is not counted.
      const runs = [...others, { id: THIS_RUN, status: "in_progress", event: "schedule" }];

      return { workflow_runs: runs.map((run) => ({ ...run, head_sha: "0".repeat(40), conclusion: null })) };
    };
    const pause = async (): Promise<void> => {
      paused += 1;
    };
    const ended = await awaitLane({ GITHUB_REPOSITORY: "ada/poplin" }, { ask, pause });

    expect({ code: ended, pauses: paused, last: step.lines.at(-1) }).toEqual({ code, pauses, last });
  });

  test("in the workflow the wait is in no lane, where it would take a waiting run's place itself, and the reset in the lane comes after it", () => {
    const jobs = Object.entries(WORKFLOW.jobs);
    const [waiting, wait] = jobs.find(([, job]) => job.steps.some((step) => step.run?.includes("scripts/live/lane.ts") === true)) ?? ["", undefined];
    const resets = jobs.filter(([, job]) => job.concurrency !== undefined && job.steps.every((step) => step.run?.includes("live:converge") !== true));

    expect(wait?.concurrency).toBeUndefined();
    expect(wait?.steps.flatMap((step) => Object.values(step.env ?? {})).filter((value) => value.includes("secrets."))).toEqual([]);
    expect(resets.map(([, job]) => [job.needs].flat())).toEqual([[waiting]]);
  });
});
