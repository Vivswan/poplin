// The wait for a commit's gate runs against a stand-in `gh` and a clock that never waits.
// Two green commits missed their deploy: a job after the gate failed on one and was cancelled on the other, and the wait followed the whole run. A wait that does so again would show on a real run alone.

import { describe, expect, test } from "bun:test";

import { waitForGate } from "../../../scripts/live/gate";

/** What GitHub answers on each turn of the wait, and how the wait ends: `runs` is the CI run of the commit, `gates` the end of its `all-green` job. `!` is a turn GitHub fails on, and a turn past the list has no answer. */
const WAIT_CASES: readonly (readonly [what: string, answers: Answers, ends: Ending])[] = [
  ["the gate is green while later jobs of the run still work", { runs: ["7 in_progress"], gates: ["success"] }, { code: 0, turns: 0, line: "all-green ended success in CI run 7" }],
  ["the gate is green and a job after it turned the whole run red", { runs: ["7 completed"], gates: ["success"] }, { code: 0, turns: 0, line: "all-green ended success in CI run 7" }],
  ["the gate is red", { runs: ["7 completed"], gates: ["failure"] }, { code: 1, turns: 0, line: "::error::all-green ended failure in CI run 7 of abc: nothing deployed" }],
  ["the gate was cancelled", { runs: ["7 completed"], gates: ["cancelled"] }, { code: 1, turns: 0, line: "::error::all-green ended cancelled in CI run 7 of abc: nothing deployed" }],
  [
    "no run yet, then a run with no gate yet, then a gate that works, then a green gate",
    { runs: ["", "7 queued", "7 in_progress", "7 in_progress"], gates: ["", "", "pending", "success"] },
    { code: 0, turns: 3, line: "all-green ended success in CI run 7" },
  ],
  [
    "GitHub fails to answer twice, then the gate is green",
    { runs: ["!", "7 in_progress", "7 in_progress"], gates: ["", "!", "success"] },
    { code: 0, turns: 2, line: "all-green ended success in CI run 7" },
  ],
  ["the run ended and holds no gate", { runs: ["7 completed"], gates: [""] }, { code: 1, turns: 0, line: "::error::CI run 7 of abc ended with no all-green check: nothing deployed" }],
  ["the ceiling is reached, after an asking every 30 seconds", { runs: [], gates: [] }, { code: 1, turns: 60, line: "::error::all-green of abc did not end within 30 minutes: nothing deployed" }],
];

/** What the stand-in `gh` answers, one line a turn. */
interface Answers {
  readonly runs: readonly string[];
  readonly gates: readonly string[];
}

/** How the wait ends: its exit code, the turns it paused, and its last line. */
interface Ending {
  readonly code: number;
  readonly turns: number;
  readonly line: string;
}

/** Runs the wait against the stand-ins, and reads how it ended and what it asked `gh`. A pause moves the clock on and takes no time. */
async function wait(answers: Answers): Promise<Ending & { readonly asked: readonly (readonly string[])[] }> {
  const asked: (readonly string[])[] = [];
  let turns = 0;
  let seconds = 0;

  const ending = await waitForGate({
    sha: "abc",
    repository: "example/poplin",
    gh: async (args) => {
      asked.push(args);
      const answer = (args[0] === "run" ? answers.runs : answers.gates)[turns] ?? "";

      return answer === "!" ? undefined : `${answer}\n`;
    },
    now: () => seconds,
    pause: async (length) => {
      turns += 1;
      seconds += length;
    },
  });

  return { ...ending, turns, asked };
}

describe("the wait for the commit's gate", () => {
  test.each(WAIT_CASES)("%s", async (_what, answers, ends) => {
    const { code, turns, line } = await wait(answers);

    expect({ code, turns, line }).toEqual(ends);
  });

  test("the gate is the `all-green` job of the run that the commit's push to main started, so no other job and no other run of the commit decides", async () => {
    const { asked } = await wait({ runs: ["7 in_progress"], gates: ["success"] });

    expect(asked).toEqual([
      ["run", "list", "--workflow", "ci.yml", "--event", "push", "--branch", "main", "--commit", "abc", "--limit", "1", "--json", "databaseId,status", "--jq", '.[] | "\\(.databaseId) \\(.status)"'],
      ["api", "--paginate", "repos/example/poplin/actions/runs/7/jobs?per_page=100", "--jq", '.jobs[] | select(.name == "all-green") | .conclusion // "pending"'],
    ]);
  });
});
