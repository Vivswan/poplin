// The live workflows' own filters, lanes, guard, and wait step, and the fuzz run and the release gate, read beside the tree.
// There is one workflow for each kind of install, and both call the one file that holds the steps and the one that holds the upgrade.
// A push that reaches an install and starts no run, a file of one kind that starts the other kind's run, a midnight reset that takes a waiting run's place, or a wait that no test drives would show on a real run alone.
// So would a job that reaches a test account from a run that may not, a fuzz target no job runs, a second copy of the fuzz command with a budget of its own, or a release gate that upgrades the test installs every night.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { fuzzTargets, seedOf } from "../../../../../tests/fuzz/plan";
import { repositoryFiles } from "../../../../../tests/support/repository-files";
import { MAIN, PULL_REQUEST, RELEASE_BOT, RELEASE_BRANCH } from "../../scripts/upgrade/admit";

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

/** The file both workflows and the release gate call: the upgrade of one install, parsed. */
const UPGRADE = parse("live-upgrade.yml");

/** The release gate, parsed. */
const GATE = parse("release-gate.yml");

/** The job of the release gate that upgrades the install of each kind. */
const GATE_JOBS = { domain: "live-upgrade-domain", "account address": "live-upgrade-account-address" } as const;

/** The environments of the two test accounts. */
const ENVIRONMENTS: readonly string[] = Object.values(KINDS).map((kind) => kind.environment);

/** The names of the secrets of a test account. */
const SECRETS: readonly string[] = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "POPLIN_LIVE_LOGIN"];

/** The files under `.github` that may name an environment or a secret of a test account: the settings, the two workflows, the files they call, and the release gate. */
const REACHING: readonly string[] = [
  ".github/settings.local.yml",
  ".github/settings.yml",
  ".github/workflows/live-checks-account-address.yml",
  ".github/workflows/live-checks.yml",
  ".github/workflows/live-install.yml",
  ".github/workflows/live-upgrade.yml",
  ".github/workflows/release-gate.yml",
];

/** The runs a job that names a test account's environment takes, as its `if:` asks: main, or the pull request of a release as the step of `scripts/upgrade/admit.ts` asks again. */
const GUARD = `github.ref == '${MAIN}' || (github.event_name == '${PULL_REQUEST}' && github.head_ref == '${RELEASE_BRANCH}' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login == '${RELEASE_BOT}')`;

/** The file that holds the fuzz run, as a caller names it. */
const FUZZ = `./${WORKFLOWS}/fuzz.yml`;

/** The seed each caller of the fuzz run passes: blank draws a new one, and the nightly passes on what a person typed. */
const SEEDS = {
  "checks.yml": "",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
  "nightly-fuzz.yml": "${{ inputs.seed }}",
  "release-gate.yml": "",
} as const;

/** The step that asks the same of the event's own file. */
const ADMIT = "bun packages/providers/cloudflare/scripts/upgrade/admit.ts";

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
  readonly if?: string;
  readonly environment?: string;
  readonly strategy?: { readonly matrix?: Readonly<Record<string, unknown>> };
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

/** The workflows of the tree, by file name. */
function workflows(): readonly string[] {
  return repositoryFiles(ROOT).flatMap((path) => (path.startsWith(`${WORKFLOWS}/`) ? [path.slice(WORKFLOWS.length + 1)] : []));
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
  test.each([
    ["the steps", (kind: Kind) => CALLERS[kind].jobs.live],
    ["the upgrade", (kind: Kind) => CALLERS[kind].jobs.upgrade],
    ["the upgrade of the release gate", (kind: Kind) => GATE.jobs[GATE_JOBS[kind]]],
  ] as const)("each workflow names its own kind and the environment of that kind's account for %s, and the two hand over nothing else that differs", (_what, jobOf) => {
    const handed = BOTH.map(jobOf);
    const pairs = handed.map((job) => ({ kind: job?.with?.kind, environment: job?.with?.environment }));
    const rest = handed.map((job) => ({ ...job, name: undefined, with: { ...job?.with, kind: undefined, environment: undefined } }));

    expect({ pairs, same: rest[0] }).toEqual({ pairs: BOTH.map((kind) => ({ kind, environment: KINDS[kind].environment })), same: rest[1] });
  });
});

describe("the secrets of the live workflows", () => {
  // A called workflow reads only the secrets it declares. A step that reads one more would be handed nothing, and would stop on the real run alone.
  test.each([
    ["the steps", STEPS, BOTH.map((kind) => CALLERS[kind].jobs.live)],
    ["the upgrade", UPGRADE, BOTH.flatMap((kind) => [CALLERS[kind].jobs.upgrade, GATE.jobs[GATE_JOBS[kind]]])],
  ] as const)("every secret a step of %s reads is one its file declares, and each caller hands over those names and no other", (_what, called, callers) => {
    const read = Object.values(called.jobs).flatMap((job) => (job.steps ?? []).flatMap((step) => Object.values(step.env ?? {}).flatMap((value) => [...String(value).matchAll(/secrets\.(\w+)/g)].map((match) => match[1] ?? ""))));
    const names = [...new Set(read)].sort();
    const declared = Object.keys(called.on.workflow_call?.secrets ?? {}).sort();
    const handed = callers.map((job) => Object.keys(job?.secrets ?? {}).sort());

    expect({ names, declared, handed }).toEqual({ names: [...SECRETS].sort(), declared: names, handed: callers.map(() => names) });
  });
});

describe("the lanes of the live workflows", () => {
  // Drift: the two kinds are two accounts, and one lane for both made each wait for the other. A lane that named no kind would be that one lane again.
  test("every job that is handed a secret waits in the lane of its kind, which keeps each waiting job, the midnight reset among them", () => {
    const touching = Object.entries({ ...STEPS.jobs, ...UPGRADE.jobs }).filter(([, job]) => job.steps?.some(holdsSecret));

    expect(Object.fromEntries(touching.map(([name, job]) => [name, job.concurrency]))).toEqual({ upgrade: LANE, checks: LANE, reset: LANE });
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

describe("the upgrade of the live workflows", () => {
  // Drift: the older build is a tree of the history whose packages are installed and whose build is run. A secret in that step's reach would be in the reach of every package of an old lockfile.
  test("the older build is installed and built in a step that is handed no secret, before the first step that is", () => {
    const steps = UPGRADE.jobs.upgrade?.steps ?? [];
    const builds = steps.findIndex((step) => step.run?.includes("live:upgrade-builds"));
    const first = steps.findIndex(holdsSecret);

    expect([builds >= 0 && builds < first, holdsSecret(steps[builds] ?? {}), steps[first]?.run?.includes("live:upgrade ")]).toEqual([true, false, true]);
  });
});

describe("the runs that reach a test account", () => {
  // Drift: the environments admit every pull request of a branch of this repository, since GitHub judges a pull request's run by a ref that names no branch. The `if:` and the step are what keep another pull request's run out.
  test("every job that names a test account's environment takes only a run of main or the pull request of a release, and asks again in a step before the first one that is handed a secret", () => {
    const naming = Object.entries({ ...STEPS.jobs, ...UPGRADE.jobs }).filter(([, job]) => job.environment !== undefined);
    const asked = naming.map(([name, job]) => {
      const steps = job.steps ?? [];
      const admits = steps.findIndex((step) => step.run === ADMIT);

      return [name, { if: job.if, admitsFirst: admits >= 0 && admits < steps.findIndex(holdsSecret) && !steps.slice(0, admits).some(holdsSecret) }];
    });

    expect(Object.fromEntries(asked)).toEqual({
      upgrade: { if: GUARD, admitsFirst: true },
      checks: { if: GUARD, admitsFirst: true },
      reset: { if: `github.event_name == 'schedule' && (${GUARD})`, admitsFirst: true },
    });
  });

  // A job written into another workflow that names an environment, or is handed a secret's name, would read a test account with no guard at all.
  test("no file under .github names an environment or a secret of a test account but the settings, the live workflows, and the release gate, and no job names an environment but the three above", () => {
    const files = repositoryFiles(ROOT).filter((path) => path.startsWith(".github/") && /\.ya?ml$/.test(path));
    const naming = files.filter((path) => [...ENVIRONMENTS, ...SECRETS].some((name) => readFileSync(join(ROOT, path), "utf8").includes(name)));
    const jobs = files
      .filter((path) => path.startsWith(`${WORKFLOWS}/`))
      .flatMap((path) => Object.entries(parse(path.slice(WORKFLOWS.length + 1)).jobs ?? {}).flatMap(([name, job]) => (job.environment === undefined ? [] : [`${path}: ${name}: ${job.environment}`])));

    expect({ naming, jobs }).toEqual({
      naming: [...REACHING],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
      jobs: ["checks", "reset"].map((job) => `${WORKFLOWS}/live-install.yml: ${job}: \${{ inputs.environment }}`).concat(`${WORKFLOWS}/live-upgrade.yml: upgrade: \${{ inputs.environment }}`),
    });
  });

  // GitHub judges a run by its ref: `main` for a run of main, and `refs/pull/<number>/merge` for every pull request. A third line would let one more kind of run read the accounts' secrets.
  test("each environment admits the branch main and the ref of a pull request's run, and no other", () => {
    const settings = Bun.YAML.parse(readFileSync(join(ROOT, ".github/settings.local.yml"), "utf8")) as { readonly environments: readonly { readonly name: string; readonly deployment_branch_policies: readonly { readonly name: string }[] }[] };
    const admitted = settings.environments.map((environment) => [environment.name, environment.deployment_branch_policies.map((policy) => policy.name)]);

    expect(Object.fromEntries(admitted)).toEqual(Object.fromEntries(ENVIRONMENTS.map((name) => [name, ["main", "refs/pull/*/merge"]])));
  });
});

describe("the wait for the commit's gate", () => {
  // The platform's shell check turns CI red on a loop written into a step, and a wait written there again is one no test here drives.
  test("the step hands the whole wait to the script that the tests of the gate drive, and holds no loop of its own", () => {
    expect({ run: WAIT.run?.trim(), loops: /\b(?:while|case|until|for)\b/.test(WAIT.run ?? "") }).toEqual({ run: "bun packages/providers/cloudflare/scripts/live/gate.ts", loops: false });
  });
});

describe("the plan of a fuzz run", () => {
  test("the targets are the files of the folder that end as a target does, by name, and no helper or other test beside them", () => {
    using folder = mkdtempDisposableSync(join(tmpdir(), "fuzz-plan-"));
    for (const file of ["names.fuzz.test.ts", "api.fuzz.test.ts", "config.ts", "plan.test.ts", "notes.fuzz.md"]) writeFileSync(join(folder.path, file), "");

    expect(fuzzTargets(folder.path)).toEqual(["api", "names"]);
  });

  test.each([
    ["a blank seed draws one", "", 0.5, 2 ** 30],
    ["no seed draws one", undefined, 0, 0],
    ["a named seed is kept", "20261117", 0.5, 20_261_117],
  ] as const)("%s", (_what, named, drawn, seed) => {
    expect(seedOf(named, () => drawn)).toBe(seed);
  });

  test("a seed that is no whole number stops the run, where the targets would each stop on it alone", () => {
    expect(() => seedOf("1.5", () => 0)).toThrow('FUZZ_SEED must be a whole number, got "1.5"');
  });
});

describe("the fuzz run of the workflows", () => {
  const run = parse("fuzz.yml").jobs;

  // The list git gives is not the one the plan reads from the disk: a target the plan missed would run in no job.
  test("every fuzz target of the tree is in the run: the plan lists them all, and the jobs are made from the plan's list", () => {
    const tracked = repositoryFiles(ROOT).flatMap((path) => /^tests\/fuzz\/([^/]+)\.fuzz\.test\.ts$/.exec(path)?.[1] ?? []);

    expect(tracked.length).toBeGreaterThan(0);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
    expect({ planned: fuzzTargets(join(ROOT, "tests", "fuzz")), matrix: run.target?.strategy?.matrix }).toEqual({ planned: tracked, matrix: { target: "${{ fromJSON(needs.plan.outputs.targets) }}" } });
  });

  // Drift: a caller that wrote the command out again would run with a budget and a list of its own.
  test("the checks, the nightly, and the release gate call that one file with the seed as its input, and no other workflow runs a fuzz target", () => {
    const callers = workflows().flatMap((file) => Object.values(parse(file).jobs).flatMap((job) => (job.uses === FUZZ ? [[file, job.with?.seed]] : [])));
    const running = workflows().filter((file) => Object.values(parse(file).jobs).some((job) => job.steps?.some((step) => step.run?.includes("tests/fuzz/") && step.run.includes("bun test"))));

    expect({ callers: Object.fromEntries(callers), running }).toEqual({ callers: SEEDS, running: ["fuzz.yml"] });
  });
});

describe("the release gate", () => {
  // Drift: the nightly calls the same file. A fuzz run or a live upgrade without its `if:` would run every night, beside the nightly fuzz, and spend the test accounts' rows.
  test("it upgrades an install of the last release on every call, and on the pull request of a release alone it fuzzes and upgrades the two real installs", () => {
    const asked = Object.fromEntries(Object.entries(parse("release-gate.yml").jobs).map(([name, job]) => [name, job.if ?? "every call"]));

    expect(asked).toEqual({
      upgrade: "every call",
      fuzz: "github.event_name == 'pull_request'",
      "live-upgrade-domain": "github.event_name == 'pull_request'",
      "live-upgrade-account-address": "github.event_name == 'pull_request'",
    });
  });
});
