// Which commit a put-back of a test install takes, asked against a stand-in `gh`.
// A push's job that installed its older commit after a newer green one, or a put-back after the live checks that took a commit whose gate was red, would show on the test installs alone.

import { describe, expect, test } from "bun:test";

import { findNewestGreen } from "../../scripts/newest-green";

/** Three commits of main, oldest first. */
const [OLD, MID, NEW] = ["a".repeat(40), "b".repeat(40), "c".repeat(40)] as const;

/** The runs of the three, newest first, as `gh run list` prints them. */
const RUNS = `3 ${NEW}\n2 ${MID}\n1 ${OLD}\n`;

/** What the search writes, by the event of the run, the commit checked out, and how the gate of each run ended: `!` is an answer GitHub failed on. */
const CASES: readonly (readonly [what: string, event: string, head: string, gates: Readonly<Record<string, string>>, found: Found, asked: readonly string[]])[] = [
  ["a push's run of the newest commit asks for no gate", "push", NEW, {}, { warning: false, line: "Newest green commit of main: ccccccc, the one checked out: installing it", outputs: {} }, []],
  [
    "a push's run whose newer commit is still judged, or red, installs its own",
    "push",
    MID,
    { 3: "pending" },
    { warning: false, line: "Newest green commit of main: bbbbbbb, the one checked out: installing it", outputs: {} },
    ["3"],
  ],
  [
    "a push's run that a newer green commit overtook makes nothing",
    "push",
    OLD,
    { 3: "failure", 2: "success" },
    { warning: false, line: "Newest green commit of main: bbbbbbb, newer than this run's aaaaaaa: its own run installs it, nothing is made here", outputs: { stale: "true" } },
    ["3", "2"],
  ],
  [
    "a run of a night whose commit is the newest green one keeps its checkout",
    "schedule",
    NEW,
    { 3: "success" },
    { warning: false, line: "Newest green commit of main: ccccccc, the one checked out: installing it", outputs: {} },
    ["3"],
  ],
  [
    "a run of a night whose commit is red takes the green one before it",
    "schedule",
    NEW,
    { 3: "failure", 2: "success" },
    { warning: false, line: "Newest green commit of main: bbbbbbb, not the one checked out (ccccccc): taking it", outputs: { sha: MID } },
    ["3", "2"],
  ],
  [
    "the pull request of a release, whose checkout is behind main's newest green commit, takes that one",
    "pull_request",
    MID,
    { 3: "success" },
    { warning: false, line: "Newest green commit of main: ccccccc, not the one checked out (bbbbbbb): taking it", outputs: { sha: NEW } },
    ["3"],
  ],
  [
    "a run with no gate, as one that was cancelled early, is no green one",
    "schedule",
    NEW,
    { 3: "", 2: "", 1: "cancelled" },
    { warning: true, line: "None of the last 100 runs of main holds a green gate: installing the commit checked out", outputs: {} },
    ["3", "2", "1"],
  ],
  [
    "a gate GitHub fails to answer for ends the search, and the checkout stays",
    "push",
    OLD,
    { 3: "!" },
    { warning: true, line: "GitHub did not say which commit of main is the newest green one: installing the commit checked out", outputs: {} },
    ["3"],
  ],
];

/** What the search found. */
interface Found {
  readonly warning: boolean;
  readonly line: string;
  readonly outputs: Readonly<Record<string, string>>;
}

/** Runs the search against the stand-in, and reads what it found and the runs whose gate it asked for. */
async function search(event: string, head: string, runs: string | undefined, gates: Readonly<Record<string, string>>): Promise<Found & { readonly asked: readonly string[] }> {
  const asked: string[] = [];
  const found = await findNewestGreen({
    event,
    repository: "example/poplin",
    head,
    gh: async (args) => {
      if (args[0] === "run") return runs;

      const run = /runs\/(\d+)\/jobs/.exec(args.join(" "))?.[1] ?? "";
      asked.push(run);

      return gates[run] === "!" ? undefined : `${gates[run] ?? ""}\n`;
    },
  });

  return { ...found, asked };
}

describe("the commit a put-back takes", () => {
  test.each(CASES)("%s", async (_what, event, head, gates, found, asked) => {
    expect(await search(event, head, RUNS, gates)).toEqual({ ...found, asked });
  });

  test("a list of runs GitHub fails to answer for leaves the checkout, with a warning", async () => {
    expect(await search("push", OLD, undefined, {})).toEqual({
      warning: true, line: "GitHub did not say which commit of main is the newest green one: installing the commit checked out",
      outputs: {},
      asked: [],
    });
  });
});
