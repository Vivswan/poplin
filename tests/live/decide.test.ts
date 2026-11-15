// The decision that holds a run of the live checks back is read beside the workflow and the tree.
// A file in no row of its table, a step that ran after a skip, or a skip worded as a failure would show on a real run alone.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempDisposableSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { decide, decideLive, ruleFor } from "../../packages/cloudflare/scripts/live/decide";
import { openRun, reportStop } from "../../packages/cloudflare/scripts/live/util";
import { plantedRepository, repositoryFiles } from "../support/repository-files";
import { catchStep } from "./support/step";

/** The repository's folder. */
const ROOT = join(import.meta.dir, "..", "..");

/** The workflow that runs the decision. */
const WORKFLOW_PATH = ".github/workflows/live-checks.yml";

/** The workflow, parsed. */
const WORKFLOW = Bun.YAML.parse(readFileSync(join(ROOT, WORKFLOW_PATH), "utf8")) as Workflow;

/** The job that touches the install: the one whose steps hold the deploy. */
const [LIVE_JOB, LIVE_STEPS] = Object.entries(WORKFLOW.jobs).flatMap(([name, job]): [string, readonly Step[]][] =>
  job.steps.some((step) => step.id === "converge") ? [[name, job.steps]] : [],
)[0] ?? ["", []];

/** The name of the step that makes the install match main, as the API tells it. */
const DEPLOY_STEP = LIVE_STEPS.find((step) => step.id === "converge")?.name ?? "";

/** The midnight job, and the name of its step that puts the install back: the job that resets and never deploys. */
const [RESET_JOB, RESET_STEP] = Object.entries(WORKFLOW.jobs).flatMap(([name, job]): [string, string][] => {
  const reset = job.steps.find((step) => step.run?.includes("live:reset") === true);

  return name === LIVE_JOB || reset?.name === undefined ? [] : [[name, reset.name]];
})[0] ?? ["", ""];

/** The id of the run that decides. */
const THIS_RUN = 99;

/** A commit no repository of a test holds. */
const NOWHERE = "f".repeat(40);

/** What every skip starts with, in the log and the summary. */
const SKIPPED = "Live checks skipped: no file that reaches the test install changed since";

/** The condition that holds a step back after a skip. */
const HELD_BACK = "steps.decide.outputs.verdict != 'skip'";

/** The condition of the reset after the checks: it runs only once the deploy did. */
const AFTER_DEPLOY = "steps.converge.outcome == 'success'";

/** One step of a workflow, as far as a test reads it. */
interface Step {
  readonly id?: string;
  readonly name?: string;
  readonly if?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, unknown>>;
}

/** A workflow, as far as a test reads it. */
interface Workflow {
  readonly jobs: Readonly<Record<string, { readonly steps: readonly Step[] }>>;
}

/** The files a commit writes, by path; `null` removes one. */
type Commit = Readonly<Record<string, string | null>>;

/** What one attempt of an earlier run came to: green after a deploy, red after one, held back by the decision, replaced while it waited, or a midnight reset that ended green or red. */
type Earlier = "green" | "red" | "held-back" | "replaced" | "midnight" | "midnight-red";

/** Changed files, and what the table makes of them. `<since>` stands for the commit the files are counted from. */
type PathCase = readonly [what: string, changed: readonly string[], verdict: "run" | "skip", reason: string];

/** A history of main, the earlier runs in the order they took the lane, and the line told. A run is of a commit, with what each attempt came to; `this` is the deciding run's own earlier attempts. `<0>` is the first commit's short name. */
type RunCase = readonly [
  what: string,
  commits: readonly Commit[],
  runs: readonly (readonly [commit: number | "nowhere" | "this", ...attempts: Earlier[]])[],
  verdict: "run" | "skip",
  line: string,
];

/** What one decision left behind. */
interface Told {
  readonly code: number;
  readonly lines: readonly string[];
  readonly summary: string;
  readonly output: Record<string, string>;
  readonly asked: readonly string[];
}

const PATH_CASES: readonly PathCase[] = [
  ["a page of the website alone", ["website/src/index.html"], "skip", "no file that reaches the test install changed since <since> (1 files, e.g. website/src/index.html)"],
  [
    "pages, pictures, the skill, a root guard, and another workflow together",
    ["README.md", "docs/using.md", "brand/icon.svg", "skills/poplin/SKILL.md", "tests/layout.test.ts", ".github/workflows/checks.yml", "biome.json"],
    "skip",
    "no file that reaches the test install changed since <since> (7 files, e.g. README.md)",
  ],
  ["no file at all, a second green run of one commit", [], "skip", "no file that reaches the test install changed since <since> (0 files)"],
  ["the Worker's own source", ["packages/cloudflare/src/worker/worker.ts"], "run", "packages/cloudflare/src/worker/worker.ts changed since <since>"],
  ["a test inside a product package", ["packages/core/tests/names/names.test.ts"], "run", "packages/core/tests/names/names.test.ts changed since <since>"],
  ["the CLI that publishes the samples", ["packages/cli/src/commands/publish.ts"], "run", "packages/cli/src/commands/publish.ts changed since <since>"],
  ["a sample site", ["demo/samples/launch-deck/index.html"], "run", "demo/samples/launch-deck/index.html changed since <since>"],
  ["a live check", ["tests/live/checks/edge.ts"], "run", "tests/live/checks/edge.ts changed since <since>"],
  ["this workflow, though the rest of its folder skips", [WORKFLOW_PATH], "run", `${WORKFLOW_PATH} changed since <since>`],
  ["the action this workflow installs with", [".github/actions/setup/action.yml"], "run", ".github/actions/setup/action.yml changed since <since>"],
  ["the lockfile", ["bun.lock"], "run", "bun.lock changed since <since>"],
  ["the Worker's configuration", ["wrangler.jsonc"], "run", "wrangler.jsonc changed since <since>"],
  ["the root manifest", ["package.json"], "run", "package.json changed since <since>"],
  ["the pin of bun", [".bun-version"], "run", ".bun-version changed since <since>"],
  ["a compiler setting at the root", ["tsconfig.json"], "run", "tsconfig.json changed since <since>"],
  ["one file that reaches the install among many that do not", ["README.md", "website/a.css", "packages/app/src/a.ts", "docs/b.md"], "run", "packages/app/src/a.ts changed since <since>"],
  ["a new folder at the root, in no row", ["notes/plan.txt"], "run", "notes/plan.txt changed since <since>, and no row of the table names it"],
  ["a new package, in no row", ["packages/mailer/src/send.ts"], "run", "packages/mailer/src/send.ts changed since <since>, and no row of the table names it"],
  ["a page below the root, which the row of root pages does not take", ["notes/README.md"], "run", "notes/README.md changed since <since>, and no row of the table names it"],
];

const RUN_CASES: readonly RunCase[] = [
  ["a page changed since the last green deploy", [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }], [[0, "green"]], "skip", `::notice::${SKIPPED} <0> (1 files, e.g. docs/a.md)`],
  ["the Worker changed since the last green deploy", [{ "docs/a.md": "1" }, { "packages/core/a.ts": "1" }], [[0, "green"]], "run", "Live checks run: packages/core/a.ts changed since <0>"],
  [
    "a file moved out of a package into the pages is listed under its old name",
    [{ "packages/core/a.md": "the same words" }, { "packages/core/a.md": null, "docs/a.md": "the same words" }],
    [[0, "green"]],
    "run",
    "Live checks run: packages/core/a.md changed since <0>",
  ],
  [
    "the files are counted from the last deploy, across a run that was held back, a run replaced while it waited, and a midnight reset",
    [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }, { "website/a.css": "1" }],
    [
      [0, "green"],
      [1, "held-back"],
      [1, "replaced"],
      [1, "midnight"],
    ],
    "skip",
    `::notice::${SKIPPED} <0> (2 files, e.g. website/a.css)`,
  ],
  [
    "a change the last run held back still counts once a later commit runs",
    [{ "docs/a.md": "1" }, { "packages/core/a.ts": "1" }, { "docs/a.md": "2" }],
    [
      [0, "green"],
      [1, "held-back"],
    ],
    "run",
    "Live checks run: packages/core/a.ts changed since <0>",
  ],
  [
    "a deploy whose checks ended red is checked again, whatever changed",
    [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }],
    [[0, "red"]],
    "run",
    "Live checks run: the last run that touched the test install, of <0>, did not end green",
  ],
  [
    "a red deploy after a green one is the one that counts",
    [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }],
    [
      [0, "green"],
      [0, "red"],
    ],
    "run",
    "Live checks run: the last run that touched the test install, of <0>, did not end green",
  ],
  ["no run ever deployed", [{ "docs/a.md": "1" }], [[0, "held-back"]], "run", "Live checks run: none of the newest runs made the test install match main"],
  ["the first run of all", [{ "docs/a.md": "1" }], [], "run", "Live checks run: none of the newest runs made the test install match main"],
  [
    "the last deploy was of a commit main no longer holds",
    [{ "docs/a.md": "1" }],
    [["nowhere", "green"]],
    "run",
    "Live checks run: fffffff, the commit of the last green deploy, is not in the history of main",
  ],
  [
    "a file of the Worker changed and put back is still counted: the install may hold the commit between",
    [{ "packages/core/a.ts": "1" }, { "packages/core/a.ts": "2" }, { "packages/core/a.ts": "1", "docs/a.md": "1" }],
    [[0, "green"]],
    "run",
    "Live checks run: packages/core/a.ts changed since <0>",
  ],
  [
    "a run that deployed red, and was started again without reaching the deploy, still counts as red",
    [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }],
    [
      [0, "green"],
      [0, "red", "replaced"],
    ],
    "run",
    "Live checks run: the last run that touched the test install, of <0>, did not end green",
  ],
  [
    "a midnight reset that ended red after the last deploy leaves an install nobody checked",
    [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }],
    [
      [0, "green"],
      [0, "midnight-red"],
    ],
    "run",
    "Live checks run: the last reset that touched the test install, of <0>, did not end green",
  ],
  [
    "a green midnight reset after a red one has put the install back",
    [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }],
    [
      [0, "green"],
      [0, "midnight-red"],
      [0, "midnight"],
    ],
    "skip",
    `::notice::${SKIPPED} <0> (1 files, e.g. docs/a.md)`,
  ],
  [
    "a first attempt of the deciding run that deployed red counts",
    [{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }],
    [
      [0, "green"],
      ["this", "red"],
    ],
    "run",
    "Live checks run: the last run that touched the test install, of <1>, did not end green",
  ],
  [
    "a first attempt of the deciding run that deployed green is the deploy to count from",
    [{ "packages/core/a.ts": "1" }, { "packages/core/a.ts": "2" }],
    [
      [0, "green"],
      ["this", "green"],
    ],
    "skip",
    `::notice::${SKIPPED} <1> (0 files)`,
  ],
];

/** Run git in a folder, without the variables a hook sets to name another repository. */
function git(root: string, args: readonly string[]): { code: number; out: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const ran = Bun.spawnSync(["git", "-C", root, ...args], { env, stdout: "pipe", stderr: "pipe" });

  return { code: ran.exitCode, out: ran.stdout.toString() };
}

/** Make one commit of the files in a planted repository, and answer its name. */
function commit(root: string, files: Commit): string {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) {
      rmSync(join(root, path));
      continue;
    }

    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  git(root, ["add", "--all"]);
  const made = git(root, ["-c", "user.name=Ada", "-c", "user.email=ada@example.com", "-c", "commit.gpgsign=false", "commit", "--quiet", "--no-verify", "--message", "a commit"]);
  expect(made.code).toBe(0);

  return git(root, ["rev-parse", "HEAD"]).out.trim();
}

/** The jobs of a run, one of each attempt, as the API tells them, with the names this repository's workflow gives the jobs and the steps. `turn` is the run's place in the lane. */
function jobsOf(attempts: readonly (Earlier | "deciding")[], turn: number): unknown {
  const jobs = attempts.map((came, index) => {
    const started_at = `2030-01-01T${String(turn).padStart(2, "0")}:0${index}:00Z`;
    const deploy = { name: DEPLOY_STEP, started_at };
    const reset = { name: RESET_STEP, started_at };
    const job = {
      green: { name: LIVE_JOB, conclusion: "success", steps: [{ ...deploy, conclusion: "success" }] },
      red: { name: LIVE_JOB, conclusion: "failure", steps: [{ ...deploy, conclusion: "success" }] },
      "held-back": { name: LIVE_JOB, conclusion: "success", steps: [{ ...deploy, conclusion: "skipped" }] },
      replaced: { name: LIVE_JOB, conclusion: "cancelled", steps: [] },
      midnight: { name: RESET_JOB, conclusion: "success", steps: [{ ...reset, conclusion: "success" }] },
      "midnight-red": { name: RESET_JOB, conclusion: "failure", steps: [{ ...reset, conclusion: "failure" }] },
      // The attempt that asks: its own deploy step, were it counted, would be the last touch, and not green.
      deciding: { name: LIVE_JOB, conclusion: null, steps: [{ ...deploy, conclusion: null }] },
    }[came];

    return { run_attempt: index + 1, ...job };
  });

  return { jobs };
}

/** Decide in a planted history of main, with GitHub answering for the earlier runs; `answer` stands in for GitHub when given. */
async function decideIn(
  commits: readonly Commit[],
  runs: RunCase[2],
  told: { readonly event?: string; readonly answer?: () => unknown } = {},
): Promise<Told & { readonly shas: readonly string[] }> {
  using tree = plantedRepository({});
  using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-live-decide-"));
  const shas = commits.map((files) => commit(tree.path, files));
  const earlier = runs.flatMap(([of, ...attempts], index) => (of === "this" ? [] : [{ id: index + 1, sha: of === "nowhere" ? NOWHERE : (shas[of] ?? NOWHERE), attempts: attempts as readonly (Earlier | "deciding")[] }]));
  const own = [...runs.flatMap(([of, ...attempts]) => (of === "this" ? attempts : [])), "deciding" as const];
  // The newest run comes last, so the last touch is found by its time and not by its place.
  const listed = [...earlier, { id: THIS_RUN, sha: shas.at(-1) ?? NOWHERE, attempts: own }];
  const asked: string[] = [];
  const env = {
    GITHUB_EVENT_NAME: told.event ?? "workflow_run",
    GITHUB_REPOSITORY: "ada/poplin",
    GITHUB_RUN_ID: String(THIS_RUN),
    GITHUB_RUN_ATTEMPT: String(own.length),
    GITHUB_STEP_SUMMARY: join(folder.path, "summary.md"),
    GITHUB_OUTPUT: join(folder.path, "output"),
  };
  using step = catchStep(env.GITHUB_OUTPUT);

  const ask = async (path: string): Promise<unknown> => {
    asked.push(path);
    if (told.answer !== undefined) return told.answer();

    if (path === `repos/ada/poplin/actions/workflows/${WORKFLOW_PATH.split("/").at(-1)}/runs?branch=main&per_page=100`) {
      return {
        workflow_runs: listed.map((run) => ({
          id: run.id,
          head_sha: run.sha,
          event: run.attempts.some((came) => came.startsWith("midnight")) ? "schedule" : "workflow_run",
          status: run.id === THIS_RUN ? "in_progress" : "completed",
          conclusion: run.id === THIS_RUN ? null : "success",
        })),
      };
    }

    const at = listed.findIndex((candidate) => path === `repos/ada/poplin/actions/runs/${candidate.id}/jobs?filter=all&per_page=100`);
    const run = listed[at];
    if (run === undefined) throw new Error(`HTTP 404: nothing at ${path}`);

    return jobsOf(run.attempts, at);
  };

  const code = await decideLive(env, { ask, git: (args) => git(tree.path, args) });
  const read = (file: string): string => readFileSync(file, "utf8");

  return { code, lines: step.lines, summary: read(env.GITHUB_STEP_SUMMARY), output: step.outputs(), asked, shas };
}

describe("the table of files that reach the test install", () => {
  test.each(PATH_CASES)("%s", (_what, changed, verdict, reason) => {
    const decision = decide("0123456789abcdef", changed);

    expect(decision.verdict).toBe(verdict);
    // A run's reason goes on to say what the row holds, in the table's own words.
    expect(decision.reason).toStartWith(reason.replace("<since>", "0123456"));
    if (verdict === "skip") expect(decision.reason).toBe(reason.replace("<since>", "0123456"));
  });

  test("every file of this repository is in a row, so a new folder or package cannot fall into a skip, or into a run, unseen", () => {
    expect(LIVE_JOB).not.toBe("");
    expect(repositoryFiles(ROOT).filter((path) => ruleFor(path) === undefined)).toEqual([]);
  });
});

describe("the decision of one run, in a planted history of main", () => {
  test.each(RUN_CASES)("%s", async (_what, commits, runs, verdict, line) => {
    const told = await decideIn(commits, runs);
    const expected = line.replace(/<(\d)>/, (_all, index: string) => told.shas[Number(index)]?.slice(0, 7) ?? "");

    expect({ code: told.code, output: told.output, said: told.lines.length }).toEqual({ code: 0, output: { verdict }, said: 1 });
    expect(told.lines[0]).toStartWith(expected);
    if (verdict === "skip") expect(told.lines[0]).toBe(expected);

    expect(told.summary).toBe(`${told.lines[0]?.replace("::notice::", "")}\n`);
  });

  test.each([
    ["GitHub refuses", (): unknown => Promise.reject(new Error("HTTP 403: Resource not accessible")), "Live checks run: the last run could not be read (Error: HTTP 403: Resource not accessible)"],
    ["GitHub answers in a shape nobody expects", (): unknown => ({ runs: [] }), "Live checks run: the last run could not be read"],
  ])("%s, and the checks run", async (_what, answer, line) => {
    const told = await decideIn([{ "docs/a.md": "1" }, { "docs/a.md": "2" }], [[0, "green"]], { answer });

    expect({ code: told.code, output: told.output }).toEqual({ code: 0, output: { verdict: "run" } });
    expect(told.lines[0]).toStartWith(line);
  });

  test("a run started by hand runs whatever changed, and asks GitHub nothing", async () => {
    const told = await decideIn([{ "docs/a.md": "1" }, { "docs/a.md": "2" }], [[0, "green"]], { event: "workflow_dispatch" });

    expect(told).toMatchObject({ code: 0, output: { verdict: "run" }, lines: ["Live checks run: the run was started by hand"], asked: [] });
  });
});

describe("a skip, beside a run that did nothing", () => {
  test("a skip is a green notice with its own words, and a run that could not start is a red error with none of them", async () => {
    const skip = await decideIn([{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }], [[0, "green"]]);
    using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-live-decide-"));
    using step = catchStep();
    const summary = join(folder.path, "summary.md");
    const run = openRun({ CLOUDFLARE_API_TOKEN: "a-made-up-token", CLOUDFLARE_ACCOUNT_ID: "0".repeat(32), GITHUB_STEP_SUMMARY: summary });
    const code = reportStop(run, { kind: "skipped", needs: "the token permission Zone: Read" }, "The live checks could not start");
    const stopped = [...step.lines, readFileSync(summary, "utf8")];

    expect({ code: skip.code, notices: skip.lines.filter((line) => line.startsWith("::notice::")).length, errors: skip.lines.filter((line) => line.includes("::error::")).length }).toEqual({
      code: 0,
      notices: 1,
      errors: 0,
    });
    expect(skip.summary).toStartWith(SKIPPED);
    expect({ code, errors: stopped.filter((line) => line.startsWith("::error::")).length, skips: stopped.filter((line) => line.includes("Live checks skipped")).length }).toEqual({
      code: 1,
      errors: 1,
      skips: 0,
    });
  });

  test("the workflow gives no secret to a step before the decision, and holds every step after it back on the output a skip writes", async () => {
    const skip = await decideIn([{ "packages/core/a.ts": "1" }, { "docs/a.md": "1" }], [[0, "green"]]);
    const at = LIVE_STEPS.findIndex((step) => step.id === "decide");
    const secrets = (step: Step): string[] => [...Object.values(step.env ?? {}), ...Object.values(step.with ?? {}).map(String)].filter((value) => value.includes("secrets."));
    const after = LIVE_STEPS.slice(at + 1);

    expect(at).toBeGreaterThan(-1);
    expect(Object.entries(skip.output).map(([name, value]) => `steps.decide.outputs.${name} != '${value}'`)).toEqual([HELD_BACK]);
    expect(LIVE_STEPS.slice(0, at + 1).flatMap(secrets)).toEqual([]);
    expect(after.flatMap(secrets).length).toBeGreaterThan(0);
    expect(after.filter((step) => step.if !== HELD_BACK && step.if !== `always() && ${AFTER_DEPLOY}`).map((step) => step.name)).toEqual([]);
  });
});
