// The live workflows' own filters, lanes, and wait step, read beside the tree. There is one workflow for each kind of install, and both call the one file that holds the steps.
// A push that reaches an install and starts no run, a file of one kind that starts the other kind's run, a midnight reset that takes a waiting run's place, or a wait that no test drives would show on a real run alone.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { repositoryFiles } from "../../../../../tests/support/repository-files";

/** The root of the repository. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/** The folder of the workflows, from the root. */
const WORKFLOWS = ".github/workflows";

/** The workflow of each kind of install, and the files that reach an install of that kind alone. Each workflow's `paths` list ends with the other kind's lines, each behind a `!`. A file that code of both kinds imports is in neither list. */
const KINDS = {
  domain: {
    file: "live-checks.yml",
    environment: "with-domain-ci-tests",
    owns: [
      "packages/providers/cloudflare/src/with-domain/pieces/bots/**",
      "packages/providers/cloudflare/src/with-domain/pieces/dns/**",
      "packages/providers/cloudflare/src/with-domain/pieces/routes/**",
      "packages/providers/cloudflare/src/with-domain/pieces/rules/guards.ts",
      "packages/providers/cloudflare/src/with-domain/pieces/rules/rules.ts",
      "packages/providers/cloudflare/src/with-domain/pieces/rules/waf.ts",
      "packages/providers/cloudflare/tests/with-domain/pieces/bots/**",
      "packages/providers/cloudflare/tests/with-domain/pieces/dns/**",
      "packages/providers/cloudflare/tests/with-domain/pieces/routes/**",
      "packages/providers/cloudflare/tests/with-domain/pieces/rules/guards.test.ts",
      "packages/providers/cloudflare/tests/with-domain/pieces/rules/waf.test.ts",
    ],
  },
  "account address": {
    file: "live-checks-account-address.yml",
    environment: "without-domain-ci-tests",
    owns: [
      "packages/providers/cloudflare/src/without-domain/pieces/forwarders/**",
      "packages/providers/cloudflare/tests/without-domain/pieces/forwarders/**",
      "packages/providers/cloudflare/src/without-domain/path-plug.ts",
      "packages/providers/cloudflare/tests/without-domain/path-plug.test.ts",
    ],
  },
} as const;

/** The files of both kinds that import a file of one kind: each runs what it imports for an install of that kind alone, or is a test. */
const DECIDERS: readonly string[] = [
  "packages/providers/cloudflare/src/shared/install/first/installer.ts",
  "packages/providers/cloudflare/src/shared/install/upkeep/remove/remove.ts",
  "packages/providers/cloudflare/src/shared/install/upkeep/repair/repair.ts",
  "packages/providers/cloudflare/src/shared/worker/hosts.ts",
  "packages/providers/cloudflare/src/with-domain/pieces/https/https.ts",
  "packages/providers/cloudflare/src/with-domain/pieces/rules/rules-follow.ts",
  "packages/providers/cloudflare/src/with-domain/zone-plug.ts",
  "packages/providers/cloudflare/tests/with-domain/pieces/rules/rules-follow.test.ts",
];

/** Both kinds, in the order of `KINDS`. */
const BOTH = Object.keys(KINDS) as readonly Kind[];

/** The workflow of each kind, parsed. */
const CALLERS = Object.fromEntries(BOTH.map((kind) => [kind, parse(KINDS[kind].file)])) as Readonly<Record<Kind, Workflow>>;

/** The file both workflows call: the steps of one install, parsed. */
const STEPS = parse("live-install.yml");

/** The lane of every job that touches the install of one kind, named by the kind the caller hands over: each waiting job is kept, and none is stopped. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
const LANE = { group: "live-checks-${{ inputs.kind }}", "cancel-in-progress": false, queue: "max" };

/** The step that waits for the commit's gate. */
const WAIT = STEPS.jobs.checks?.steps?.find((step) => step.name?.startsWith("Wait for")) as Step;

/** What reads the imports of a file of the tree, by the end of its name. */
const SCANNERS = { ts: new Bun.Transpiler({ loader: "ts" }), tsx: new Bun.Transpiler({ loader: "tsx" }) };

/** One file of the tree that each kind's lines name. */
const SAMPLE = Object.fromEntries(BOTH.map((kind) => [kind, repositoryFiles(ROOT).find((path) => KINDS[kind].owns.some((line) => new Bun.Glob(line).match(path))) ?? ""])) as Readonly<Record<Kind, string>>;

/** The files of one push, and the kinds of install whose workflow GitHub starts for them. */
const PUSH_CASES: readonly (readonly [what: string, changed: readonly string[], starts: readonly Kind[]])[] = [
  ["a page of the website alone", ["website/src/index.html"], []],
  [
    "pages, pictures, the skill, a root guard, another workflow, and a lint setting together",
    ["README.md", "docs/sites/publish.md", "brand/icon.svg", "skills/poplin/SKILL.md", "tests/layout.test.ts", ".github/workflows/checks.yml", "biome.json"],
    [],
  ],
  ["a fuzz test and a helper the tests share", ["tests/fuzz/names.test.ts", "tests/support/markdown-page.ts"], []],
  ["the Worker's own source", ["packages/providers/cloudflare/src/shared/worker/worker.ts"], BOTH],
  ["the file that decides the kind of an install", ["packages/providers/cloudflare/src/shared/worker/hosts.ts"], BOTH],
  ["a file of the core", ["packages/core/src/names/names.ts"], BOTH],
  ["a test inside a product package", ["packages/core/tests/names/names.test.ts"], BOTH],
  ["a page inside a product package or beside the live checks, which reaches no install", ["packages/cli/README.md", "packages/providers/cloudflare/live/README.md", "demo/README.md"], []],
  ["a page inside a product package among files that reach the install", ["packages/cli/README.md", "packages/cli/src/poplin.ts"], BOTH],
  ["a sample site", ["demo/samples/launch-deck/index.html"], BOTH],
  ["a live check, which runs on an install of either kind", ["packages/providers/cloudflare/live/checks/edge.ts"], BOTH],
  ["the steps both workflows call", [".github/workflows/live-install.yml"], BOTH],
  ["the action the steps install with", [".github/actions/setup/action.yml"], BOTH],
  ["the lockfile", ["bun.lock"], BOTH],
  ["a dotfile at the root that no line names", [".gitattributes"], BOTH],
  ["a folder that no line names", ["plugins/a/index.ts"], BOTH],
  ["a new folder of tests that no line names", ["tests/browser/a.test.ts"], BOTH],
  ["one file that reaches the install among pages", ["docs/sites/publish.md", "wrangler.jsonc", "README.md"], BOTH],
  ["the plug of an install with a domain, whose pieces the plug of the other kind is made of", ["packages/providers/cloudflare/src/with-domain/zone-plug.ts"], BOTH],
  ["a file of an install with a domain alone", [SAMPLE.domain], ["domain"]],
  ["a file of an install without a domain alone", [SAMPLE["account address"]], ["account address"]],
  ["a file of each kind together", [SAMPLE.domain, SAMPLE["account address"]], BOTH],
  ["a file of one kind among pages", ["docs/sites/publish.md", SAMPLE["account address"]], ["account address"]],
  ["the workflow of one kind", [".github/workflows/live-checks.yml"], ["domain"]],
];

/** A kind of install. */
type Kind = keyof typeof KINDS;

/** One step of a workflow, as far as a test reads it. */
interface Step {
  readonly name?: string;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string | number>>;
}

/** One job of a workflow, as far as a test reads it. */
interface Job {
  readonly concurrency?: Readonly<Record<string, unknown>>;
  readonly steps?: readonly Step[];
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly secrets?: Readonly<Record<string, string>>;
}

/** A workflow, as far as a test reads it. */
interface Workflow {
  readonly on: { readonly push: { readonly branches: readonly string[]; readonly paths: readonly string[] }; readonly workflow_call?: { readonly secrets?: Readonly<Record<string, unknown>> } } & Readonly<Record<string, unknown>>;
  readonly concurrency?: Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

/** A workflow of the repository, parsed. */
function parse(file: string): Workflow {
  return Bun.YAML.parse(readFileSync(join(ROOT, WORKFLOWS, file), "utf8")) as Workflow;
}

/** The other kind of install. */
function otherOf(kind: Kind): Kind {
  return kind === "domain" ? "account address" : "domain";
}

/** Whether a step is handed a secret. */
function holdsSecret(step: Step): boolean {
  return Object.values(step.env ?? {}).some((value) => String(value).includes("secrets."));
}

/** Whether one changed file starts the workflow of a kind, as GitHub reads a `paths` list: the last line that matches decides, and a `!` line takes the file out. */
function starts(kind: Kind, path: string): boolean {
  const last = CALLERS[kind].on.push.paths.filter((line) => new Bun.Glob(line.replace(/^!/, "")).match(path)).at(-1);

  return last !== undefined && !last.startsWith("!");
}

/** The kinds whose workflow a push of these files starts. */
function started(changed: readonly string[]): readonly Kind[] {
  return BOTH.filter((kind) => changed.some((path) => starts(kind, path)));
}

/** The kind a file reaches alone, by the lists of `KINDS` and each workflow's own file; `undefined` for a file of both kinds or of none. */
function ownerOf(path: string): Kind | undefined {
  return BOTH.find((kind) => [...KINDS[kind].owns, `${WORKFLOWS}/${KINDS[kind].file}`].some((line) => new Bun.Glob(line).match(path)));
}

/** The files of the tree a file imports for more than their types, as paths from the root. A module outside the tree, or one the runtime alone knows, is left out. */
function importsOf(path: string): readonly string[] {
  const imported: string[] = [];

  // A script opens with the line that names its runtime, which is no line of the language.
  const source = readFileSync(join(ROOT, path), "utf8").replace(/^#!.*/, "");

  for (const found of SCANNERS[path.endsWith("x") ? "tsx" : "ts"].scanImports(source)) {
    try {
      imported.push(relative(ROOT, Bun.resolveSync(found.path, dirname(join(ROOT, path)))).replaceAll("\\", "/"));
    } catch {
      // No file of the tree: a package of the registry that is not installed, or a module of the runtime.
    }
  }

  return imported;
}

describe("the files of a push that start the live checks of each kind of install", () => {
  test.each(PUSH_CASES)("%s", (_what, changed, expected) => {
    expect(started(changed)).toEqual(expected);
  });

  test.each(BOTH)("the filter of %s opens with every file, so a file no line names starts a run, and only a push to main is filtered", (kind) => {
    const on = CALLERS[kind].on;

    expect({ first: on.push.paths[0], branches: on.push.branches, others: Object.keys(on).sort() }).toEqual({ first: "**", branches: ["main"], others: ["push", "schedule", "workflow_dispatch"] });
  });

  // YAML holds no shared list, so each workflow writes the lines out. A line added to one file alone would start one kind's checks for a file that reaches both.
  test("the two filters are one list: each names its own workflow, and ends with the lines of the other kind, taken out", () => {
    const tails = BOTH.map((kind) => CALLERS[kind].on.push.paths.slice(-KINDS[otherOf(kind)].owns.length));
    const heads = BOTH.map((kind) => CALLERS[kind].on.push.paths.slice(0, -KINDS[otherOf(kind)].owns.length).map((line) => line.replace(KINDS[kind].file, "<its own file>")));

    expect({ tails, same: heads[0] }).toEqual({ tails: BOTH.map((kind) => KINDS[otherOf(kind)].owns.map((line) => `!${line}`)), same: heads[1] });
  });

  // A folder that moved leaves its line behind: the files then start both workflows again, and nothing says so.
  test("every line of a kind names a file of the tree", () => {
    const files = repositoryFiles(ROOT);
    const empty = BOTH.flatMap((kind) => KINDS[kind].owns.filter((line) => !files.some((path) => new Bun.Glob(line).match(path))));

    expect(empty).toEqual([]);
  });

  test("a file of the tree starts the workflow of its kind alone when a line of that kind names it, and else both workflows or neither", () => {
    const wrong = repositoryFiles(ROOT).filter((path) => {
      const owner = ownerOf(path);
      const count = started([path]).length;

      return owner === undefined ? count === 1 : count !== 1 || !starts(owner, path);
    });

    expect(wrong).toEqual([]);
  });

  // A file of one kind that code of both kinds runs reaches both installs, and a push of it would check one. The demo, which every install serves, is such code.
  test("a file of one kind is imported by files of that kind, and by the listed files of both kinds, alone", () => {
    const outside = repositoryFiles(ROOT)
      .filter((path) => /\.tsx?$/.test(path) && !path.endsWith(".d.ts"))
      .filter((path) => importsOf(path).some((imported) => ownerOf(imported) !== undefined && ownerOf(imported) !== ownerOf(path)));

    expect(outside).toEqual([...DECIDERS]);
  });
});

describe("what each workflow hands the steps", () => {
  // The kind tells every script which install to find, and the environment holds the account: a pair that crossed would look for one kind of install on the other kind's account.
  test("each workflow names its own kind and the environment of that kind's account, and the two hand the steps nothing else that differs", () => {
    const handed = BOTH.map((kind) => CALLERS[kind].jobs.live);
    const pairs = handed.map((job) => ({ kind: job?.with?.kind, environment: job?.with?.environment }));
    const rest = handed.map((job) => ({ ...job, name: undefined, with: { ...job?.with, kind: undefined, environment: undefined } }));

    expect({ pairs, same: rest[0] }).toEqual({ pairs: BOTH.map((kind) => ({ kind, environment: KINDS[kind].environment })), same: rest[1] });
  });
});

describe("the secrets of the live workflows", () => {
  // A called workflow reads only the secrets it declares. A step that reads one more would be handed nothing, and would stop on the real run alone.
  test("every secret a step reads is one the steps' file declares, and each workflow hands over those names and no other", () => {
    const read = Object.values(STEPS.jobs).flatMap((job) => (job.steps ?? []).flatMap((step) => Object.values(step.env ?? {}).flatMap((value) => [...String(value).matchAll(/secrets\.(\w+)/g)].map((match) => match[1] ?? ""))));
    const names = [...new Set(read)].sort();
    const declared = Object.keys(STEPS.on.workflow_call?.secrets ?? {}).sort();
    const handed = BOTH.map((kind) => Object.keys(CALLERS[kind].jobs.live?.secrets ?? {}).sort());

    expect({ declared, handed }).toEqual({ declared: names, handed: [names, names] });
  });
});

describe("the lanes of the live workflows", () => {
  // Drift: the two kinds are two accounts, and one lane for both made each wait for the other. A lane that named no kind would be that one lane again.
  test("every job that is handed a secret waits in the lane of its kind, which keeps each waiting job, the midnight reset among them", () => {
    const touching = Object.entries(STEPS.jobs).filter(([, job]) => job.steps?.some(holdsSecret));

    expect(Object.fromEntries(touching.map(([name, job]) => [name, job.concurrency]))).toEqual({ checks: LANE, reset: LANE });
  });

  test("a waiting run is replaced by a newer run of its own workflow and event alone, so a push never takes the place of the midnight run or of the other kind's run", () => {
    expect(Object.fromEntries(BOTH.map((kind) => [kind, CALLERS[kind].concurrency]))).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
      domain: { group: "live-checks-domain-${{ github.event_name }}", "cancel-in-progress": false },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
      "account address": { group: "live-checks-account-address-${{ github.event_name }}", "cancel-in-progress": false },
    });
  });
});

describe("the wait for the commit's gate", () => {
  // The platform's shell check turns CI red on a loop written into a step, and a wait written there again is one no test here drives.
  test("the step hands the whole wait to the script that the tests of the gate drive, and holds no loop of its own", () => {
    expect({ run: WAIT.run?.trim(), loops: /\b(?:while|case|until|for)\b/.test(WAIT.run ?? "") }).toEqual({ run: "bun packages/providers/cloudflare/scripts/live/gate.ts", loops: false });
  });
});
