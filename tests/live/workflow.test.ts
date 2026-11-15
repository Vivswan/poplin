// The live workflow's own filter and lanes, read beside the tree.
// A push that reaches the install and starts no run, or a midnight reset that takes a waiting run's place would show on a real run alone.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The workflow, parsed. */
const WORKFLOW = Bun.YAML.parse(readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "live-checks.yml"), "utf8")) as Workflow;

/** The path filter of a push, in the order GitHub reads it. */
const PATHS = WORKFLOW.on.push.paths;

/** The one lane of every job that touches the install: each waiting job is kept, and none is stopped. */
const LANE = { group: "live-checks", "cancel-in-progress": false, queue: "max" };

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
  readonly env?: Readonly<Record<string, string>>;
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

/** Whether a step is handed a secret. */
function holdsSecret(step: Step): boolean {
  return Object.values(step.env ?? {}).some((value) => value.includes("secrets."));
}

/** Whether one changed file starts a run, as GitHub reads a `paths` list: the last line that matches decides, and a `!` line takes the file out. */
function starts(path: string): boolean {
  const last = PATHS.filter((line) => new Bun.Glob(line.replace(/^!/, "")).match(path)).at(-1);

  return last !== undefined && !last.startsWith("!");
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
