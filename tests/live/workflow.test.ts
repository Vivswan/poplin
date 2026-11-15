// The live workflow's own filter, lanes, and wait, read beside the tree.
// A push that reaches the install and starts no run, a midnight reset that takes a waiting run's place, or a wait that a job after the gate turns red would show on a real run alone.

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/** The workflow, parsed. */
const WORKFLOW = Bun.YAML.parse(readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "live-checks.yml"), "utf8")) as Workflow;

/** The path filter of a push, in the order GitHub reads it. */
const PATHS = WORKFLOW.on.push.paths;

/** The one lane of every job that touches the install: each waiting job is kept, and none is stopped. */
const LANE = { group: "live-checks", "cancel-in-progress": false, queue: "max" };

/** The step of the `live` job that waits for the commit's gate. */
const WAIT = WORKFLOW.jobs.live?.steps.find((step) => step.name?.startsWith("Wait for")) as Step;

/** The stand-ins first on the PATH of the wait. A `gh` that answers each asking with the line of its turn, fails on a `!` line, and knows no `gh run watch`. A `sleep` that ends the turn at once. */
const STAND_IN_FILES: Readonly<Record<string, string>> = {
  gh: `#!/bin/sh
turn=$(( $(wc -c < "$STAND_INS/turns") + 1 ))
case "$1 $2" in
  "run list") answers=runs ;;
  "api --paginate") answers=gates ;;
  *) exit 1 ;;
esac
echo "$*" >> "$STAND_INS/asked"
answer=$(sed -n "\${turn}p" "$STAND_INS/$answers")
[ "$answer" = "!" ] && exit 1
[ -z "$answer" ] || echo "$answer"
`,
  sleep: `#!/bin/sh
printf x >> "$STAND_INS/turns"
`,
};

/** What GitHub answers on each turn of the wait, and how the wait ends: `runs` is the CI run of the commit, `gates` the end of its `all-green` job. */
const WAIT_CASES: readonly (readonly [what: string, answers: Answers, ends: Ending])[] = [
  ["the gate is green while later jobs of the run still work", { runs: ["7 in_progress"], gates: ["success"] }, { code: 0, turns: 0 }],
  ["the gate is green and a job after it turned the whole run red", { runs: ["7 completed"], gates: ["success"] }, { code: 0, turns: 0 }],
  ["the gate is red", { runs: ["7 completed"], gates: ["failure"] }, { code: 1, turns: 0, says: "::error::all-green ended failure in CI run 7" }],
  ["the gate was cancelled", { runs: ["7 completed"], gates: ["cancelled"] }, { code: 1, turns: 0, says: "::error::all-green ended cancelled in CI run 7" }],
  [
    "no run yet, then a run with no gate yet, then a gate that works, then a green gate",
    { runs: ["", "7 queued", "7 in_progress", "7 in_progress"], gates: ["", "", "pending", "success"] },
    { code: 0, turns: 3 },
  ],
  ["GitHub fails to answer twice, then the gate is green", { runs: ["!", "7 in_progress", "7 in_progress"], gates: ["", "!", "success"] }, { code: 0, turns: 2 }],
  ["the run ended and holds no gate", { runs: ["7 completed"], gates: [""] }, { code: 1, turns: 0, says: "::error::CI run 7 of abc ended with no all-green check" }],
  ["the ceiling is reached", { runs: [], gates: [], ceiling: "0" }, { code: 1, turns: 0, says: "::error::all-green of abc did not end within 0 minutes" }],
];

/** The files of one push, and whether GitHub starts a run for them. */
const PUSH_CASES: readonly (readonly [what: string, changed: readonly string[], starts: boolean])[] = [
  ["a page of the website alone", ["website/src/index.html"], false],
  [
    "pages, pictures, the skill, a root guard, another workflow, and a lint setting together",
    ["README.md", "docs/using.md", "brand/icon.svg", "skills/poplin/SKILL.md", "tests/layout.test.ts", ".github/workflows/checks.yml", "biome.json"],
    false,
  ],
  ["a fuzz test and a test of the release scripts", ["tests/fuzz/names.test.ts", "tests/release-pipeline/version.test.ts"], false],
  ["the Worker's own source", ["packages/cloudflare/src/worker/worker.ts"], true],
  ["a test inside a product package", ["packages/core/tests/names/names.test.ts"], true],
  ["a page inside a product package, which the root pattern for pages leaves alone", ["packages/cli/README.md"], true],
  ["a sample site", ["demo/samples/launch-deck/index.html"], true],
  ["a live check", ["tests/live/checks/edge.ts"], true],
  ["this workflow, though the rest of its folder starts nothing", [".github/workflows/live-checks.yml"], true],
  ["the action this workflow installs with", [".github/actions/setup/action.yml"], true],
  ["the lockfile", ["bun.lock"], true],
  ["a dotfile at the root that no line names", [".gitattributes"], true],
  ["a folder that no line names", ["plugins/a/index.ts"], true],
  ["a new folder of tests that no line names", ["tests/browser/a.test.ts"], true],
  ["one file that reaches the install among pages", ["docs/using.md", "wrangler.jsonc", "README.md"], true],
];

/** One step of a workflow, as far as a test reads it. */
interface Step {
  readonly name?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string | number>>;
}

/** One job of a workflow, as far as a test reads it. */
interface Job {
  readonly concurrency?: Readonly<Record<string, unknown>>;
  readonly steps: readonly Step[];
}

/** A workflow, as far as a test reads it. */
interface Workflow {
  readonly on: { readonly push: { readonly branches: readonly string[]; readonly paths: readonly string[] } } & Readonly<Record<string, unknown>>;
  readonly concurrency?: Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

/** What the stand-in `gh` answers, one line a turn. */
interface Answers {
  readonly runs: readonly string[];
  readonly gates: readonly string[];
  readonly ceiling?: string;
}

/** How the wait ends: its exit code, the turns it slept, and the start of the line it stops with. */
interface Ending {
  readonly code: number;
  readonly turns: number;
  readonly says?: string;
}

/** Whether a step is handed a secret. */
function holdsSecret(step: Step): boolean {
  return Object.values(step.env ?? {}).some((value) => String(value).includes("secrets."));
}

/** Whether one changed file starts a run, as GitHub reads a `paths` list: the last line that matches decides, and a `!` line takes the file out. */
function starts(path: string): boolean {
  const last = PATHS.filter((line) => new Bun.Glob(line.replace(/^!/, "")).match(path)).at(-1);

  return last !== undefined && !last.startsWith("!");
}

/** Runs the wait's own script as GitHub does, against the stand-ins, and reads how it ended and what it asked `gh`. */
function wait(answers: Answers): Ending & { readonly asked: string } {
  using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-live-wait-"));
  const files = { ...STAND_IN_FILES, runs: answers.runs.join("\n"), gates: answers.gates.join("\n"), turns: "", asked: "" };

  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(folder.path, name), text);
    chmodSync(join(folder.path, name), 0o755);
  }

  const ran = Bun.spawnSync(["bash", "-e", "-c", WAIT.run ?? ""], {
    env: {
      PATH: `${folder.path}${delimiter}${process.env.PATH}`,
      STAND_INS: folder.path,
      GITHUB_SHA: "abc",
      GITHUB_REPOSITORY: "example/poplin",
      CEILING_SECONDS: answers.ceiling ?? String(WAIT.env?.CEILING_SECONDS),
    },
  });

  return {
    code: ran.exitCode,
    turns: readFileSync(join(folder.path, "turns"), "utf8").length,
    says: ran.stdout
      .toString()
      .split("\n")
      .find((line) => line.startsWith("::error::")),
    asked: readFileSync(join(folder.path, "asked"), "utf8"),
  };
}

describe("the files of a push that start the live checks", () => {
  test.each(PUSH_CASES)("%s", (_what, changed, expected) => {
    expect(changed.some(starts)).toBe(expected);
  });

  test("the filter opens with every file, so a file no line names starts a run, and only a push to main is filtered", () => {
    expect({ first: PATHS[0], branches: WORKFLOW.on.push.branches, others: Object.keys(WORKFLOW.on).sort() }).toEqual({
      first: "**",
      branches: ["main"],
      others: ["push", "schedule", "workflow_dispatch"],
    });
  });
});

describe("the lanes of the live workflow", () => {
  test("every job that is handed a secret waits in the one lane that keeps each waiting job, the midnight reset among them", () => {
    const touching = Object.entries(WORKFLOW.jobs).filter(([, job]) => job.steps.some(holdsSecret));

    expect(Object.fromEntries(touching.map(([name, job]) => [name, job.concurrency]))).toEqual({ live: LANE, reset: LANE });
  });

  test("a waiting run is replaced by a newer run of its own event alone, so a push never takes the midnight run's place", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
    expect(WORKFLOW.concurrency).toEqual({ group: "live-checks-${{ github.event_name }}", "cancel-in-progress": false });
  });
});

describe("the wait for the commit's gate", () => {
  // Two green commits missed their deploy: a job after the gate failed on one and was cancelled on the other, and the wait followed the whole run.
  test.each(WAIT_CASES)("%s", (_what, answers, ends) => {
    const { code, turns, says } = wait(answers);

    expect({ code, turns, says: says?.slice(0, ends.says?.length) }).toEqual({ code: ends.code, turns: ends.turns, says: ends.says });
  });

  test("the gate is the `all-green` job of the run that the commit's push to main started, so no other job and no other run of the commit decides", () => {
    const [run, gate] = wait({ runs: ["7 in_progress"], gates: ["success"] }).asked.split("\n");

    expect({ run: run?.startsWith("run list --workflow ci.yml --event push --branch main --commit abc --limit 1 "), gate }).toEqual({
      run: true,
      gate: 'api --paginate repos/example/poplin/actions/runs/7/jobs?per_page=100 --jq .jobs[] | select(.name == "all-green") | .conclusion // "pending"',
    });
  });
});
