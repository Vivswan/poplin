// The live workflows' own lanes, guard, and report, and the fuzz run, the release gate, and the release's live tests, read beside the tree.
// There is one workflow for each kind of install, and both call the one file that holds the steps and the one that holds the upgrade.
// A midnight reset that takes a waiting run's place, or a red night that files nothing would show on a real run alone.
// So would a job that reaches a test account from a run that may not, a fuzz target no job runs, a second copy of the fuzz command with a budget of its own, or an upgrade of the test installs under a caller that hands it no secret.
// So would a release whose live checks ran only where an upgrade reached the install, or that left a test install without the samples and the demo.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fuzzTargets, seedOf } from "../../../../../tests/fuzz/plan";
import { repositoryFiles } from "../../../../../tests/support/repository-files";
import { readFrom } from "../../migrations/older-from";
import { MAIN, PULL_REQUEST, RELEASE_BOT, RELEASE_BRANCH } from "../../scripts/admit";

/** The root of the repository. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

/** The folder of the workflows, from the root. */
const WORKFLOWS = ".github/workflows";

/** The workflow of each kind of install, the environment of its account, and the label of the issue a red night of it files. */
const KINDS = {
  domain: { file: "live-checks.yml", environment: "with-domain-ci-tests", label: "live-nightly-domain" },
  "account address": { file: "live-checks-account-address.yml", environment: "without-domain-ci-tests", label: "live-nightly-account-address" },
} as const;

/** Both kinds, in the order of `KINDS`. */
const BOTH = Object.keys(KINDS) as readonly Kind[];

/** The workflow of each kind, parsed. */
const CALLERS = Object.fromEntries(BOTH.map((kind) => [kind, parse(KINDS[kind].file)])) as Readonly<Record<Kind, Workflow>>;

/** The file both workflows call: the steps of one install, parsed. */
const STEPS = parse("live-install.yml");

/** The file both workflows and the release's own workflow call: the upgrade of one install, parsed. */
const UPGRADE = parse("live-upgrade.yml");

/** The workflow that upgrades both installs on the pull request of a release, then checks each and puts it back, parsed. */
const RELEASE = parse("release-live-upgrade.yml");

/** The job of that workflow that upgrades the install of each kind. */
const RELEASE_JOBS = { domain: "domain", "account address": "account-address" } as const;

/** The job of that workflow that upgrades the install of each kind from a pre-release, as advice. */
const ADVICE_JOBS = { domain: "domain-next", "account address": "account-address-next" } as const;

/** The job of that workflow that runs the live checks on the install of each kind after its upgrades, and puts it back. */
const CHECKS_JOBS = { domain: "checks-domain", "account address": "checks-account-address" } as const;

/** The action that files and closes the issue of a red night. */
const ISSUE = "Vivswan/repo-platform/actions/fuzz-issue@stable";

/** The environments of the two test accounts. */
const ENVIRONMENTS: readonly string[] = Object.values(KINDS).map((kind) => kind.environment);

/** The names of the secrets of a test account. */
const SECRETS: readonly string[] = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "POPLIN_LIVE_LOGIN"];

/** The files under `.github` that may name an environment or a secret of a test account: the settings, the two workflows, the files they call, and the release's live upgrade. */
const REACHING: readonly string[] = [
  ".github/settings.local.yml",
  ".github/settings.yml",
  ".github/workflows/live-checks-account-address.yml",
  ".github/workflows/live-checks.yml",
  ".github/workflows/live-install.yml",
  ".github/workflows/live-upgrade.yml",
  ".github/workflows/release-live-upgrade.yml",
];

/** The runs a job that names a test account's environment takes, as its `if:` asks: main, or the pull request of a release as the step of `scripts/admit.ts` asks again. */
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
const ADMIT = "bun packages/providers/cloudflare/scripts/admit.ts";

/** The lane of every job that touches the install of one kind, named by the kind the caller hands over: each waiting job is kept, and none is stopped. */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the expression is the workflow's own, read by GitHub.
const LANE = { group: "live-checks-${{ inputs.kind }}", "cancel-in-progress": false, queue: "max" };

/** A kind of install. */
type Kind = keyof typeof KINDS;

/** One step of a workflow, as far as a test reads it. */
interface Step {
  readonly name?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly run?: string;
  readonly env?: Readonly<Record<string, string | number>>;
}

/** One job of a workflow, as far as a test reads it. */
interface Job {
  readonly if?: string;
  readonly needs?: readonly string[];
  readonly permissions?: Readonly<Record<string, string>>;
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
  readonly on: { readonly workflow_call?: { readonly secrets?: Readonly<Record<string, unknown>> } } & Readonly<Record<string, unknown>>;
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

/** Whether a step is handed a secret. */
function holdsSecret(step: Step): boolean {
  return Object.values(step.env ?? {}).some((value) => String(value).includes("secrets."));
}

describe("the report of a red night", () => {
  // Drift: a red midnight run is a red row in a list nobody opens. One label for both kinds would let the green kind close the red kind's issue.
  test.each(BOTH)("a red or cancelled midnight run of %s files the issue of its own label, a green one closes it, and a run by hand does neither", (kind) => {
    const report = CALLERS[kind].jobs.report;
    const steps = (report?.steps ?? []).map((step) => ({ if: step.if, uses: step.uses, mode: step.with?.mode, label: step.with?.label, stream: step.with?.stream }));

    expect({ if: report?.if, needs: report?.needs, permissions: report?.permissions, steps }).toEqual({
      if: "always() && github.event_name == 'schedule'",
      needs: ["live"],
      permissions: { issues: "write" },
      steps: [
        { if: "needs.live.result == 'failure' || needs.live.result == 'cancelled'", uses: ISSUE, mode: "report", label: KINDS[kind].label, stream: "generic" },
        { if: "needs.live.result == 'success'", uses: ISSUE, mode: "resolve", label: KINDS[kind].label, stream: "generic" },
      ],
    });
  });
});

describe("what each workflow hands the steps", () => {
  // The kind tells every script which install to find, and the environment holds the account: a pair that crossed would look for one kind of install on the other kind's account.
  test.each([
    ["the steps", (kind: Kind) => CALLERS[kind].jobs.live],
    ["the upgrade", (kind: Kind) => CALLERS[kind].jobs.upgrade],
    ["the upgrade from a pre-release", (kind: Kind) => CALLERS[kind].jobs["upgrade-next"]],
    ["the upgrade of a release", (kind: Kind) => RELEASE.jobs[RELEASE_JOBS[kind]]],
    ["the upgrade of a release from a pre-release", (kind: Kind) => RELEASE.jobs[ADVICE_JOBS[kind]]],
    ["the checks after the upgrades of a release", (kind: Kind) => RELEASE.jobs[CHECKS_JOBS[kind]]],
  ] as const)("each workflow names its own kind and the environment of that kind's account for %s, and the two hand over nothing else that differs", (_what, jobOf) => {
    const handed = BOTH.map(jobOf);
    const pairs = handed.map((job) => ({ kind: job?.with?.kind, environment: job?.with?.environment }));
    // A job waits for the upgrades of its own kind, under those jobs' names: one that waited for the other kind's could run beside its own upgrade, or before it, which then leaves the install as before.
    const own = (job: Job | undefined): readonly (readonly [name: string, role: string])[] =>
      BOTH.filter((kind) => job?.with?.kind === kind).flatMap((kind) => [[ADVICE_JOBS[kind], "the advice of its own kind"] as const, [RELEASE_JOBS[kind], "the upgrade of its own kind"] as const]);
    const waits = (job: Job | undefined): readonly string[] => (job?.needs ?? []).map((name) => own(job).find(([known]) => known === name)?.[1] ?? name);
    const asks = (job: Job | undefined): string | undefined => own(job).reduce((text, [name, role]) => text?.replaceAll(`needs.${name}.`, `needs.<${role}>.`), job?.if);
    const rest = handed.map((job) => ({ ...job, name: undefined, if: asks(job), needs: waits(job), with: { ...job?.with, kind: undefined, environment: undefined } }));

    expect({ pairs, same: rest[0] }).toEqual({ pairs: BOTH.map((kind) => ({ kind, environment: KINDS[kind].environment })), same: rest[1] });
  });
});

describe("the secrets of the live workflows", () => {
  // A called workflow reads only the secrets it declares. A step that reads one more would be handed nothing, and would stop on the real run alone.
  test.each([
    ["the steps", STEPS, BOTH.flatMap((kind) => [CALLERS[kind].jobs.live, RELEASE.jobs[CHECKS_JOBS[kind]]])],
    ["the upgrade", UPGRADE, BOTH.flatMap((kind) => [CALLERS[kind].jobs.upgrade, CALLERS[kind].jobs["upgrade-next"], RELEASE.jobs[RELEASE_JOBS[kind]], RELEASE.jobs[ADVICE_JOBS[kind]]])],
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

  test("a waiting run is replaced by a newer run of its own workflow and event alone, so a run by hand never takes the place of the midnight run or of the other kind's run", () => {
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

  // Drift: a start the script does not know stops the step, on the run of a release alone.
  test("each caller names where its two upgrades of a kind start from by the names the script reads: the last release, then a pre-release", () => {
    const pairs = BOTH.flatMap((kind) => [[CALLERS[kind].jobs.upgrade, CALLERS[kind].jobs["upgrade-next"]] as const, [RELEASE.jobs[RELEASE_JOBS[kind]], RELEASE.jobs[ADVICE_JOBS[kind]]] as const]);
    const start = (job: Job | undefined): string => readFrom({ POPLIN_UPGRADE_FROM: String(job?.with?.from) });

    expect(pairs.map(([first, second]) => [start(first), start(second)])).toEqual(pairs.map(() => ["release", "next"]));
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
  test("no file under .github names an environment or a secret of a test account but the settings, the live workflows, and the release's live upgrade, and no job names an environment but the three above", () => {
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
  // Drift: the nightly calls the same file. A fuzz run without its `if:` would run every night, beside the nightly fuzz.
  test("it upgrades an install of the last release on every call, and on the pull request of a release alone it fuzzes", () => {
    const asked = Object.fromEntries(Object.entries(parse("release-gate.yml").jobs).map(([name, job]) => [name, job.if ?? "every call"]));

    expect(asked).toEqual({ upgrade: "every call", fuzz: "github.event_name == 'pull_request'" });
  });
});

describe("the live tests of a release", () => {
  // GitHub hands a called workflow only the secrets its caller passes, and a job two calls deep under a caller that passes none reads empty values: the upgrade of a release stopped there, on the real run alone.
  test.each(["live-upgrade.yml", "live-install.yml"])("the event starts each workflow that calls %s, so no workflow between them can hold the secrets back", (called) => {
    const callers = workflows().filter((file) => Object.values(parse(file).jobs).some((job) => job.uses === `./${WORKFLOWS}/${called}`));

    expect(Object.fromEntries(callers.map((file) => [file, Object.keys(parse(file).on).includes("workflow_call")]))).toEqual({
      "live-checks-account-address.yml": false,
      "live-checks.yml": false,
      "release-live-upgrade.yml": false,
    });
  });

  // Drift: the workflow starts for every pull request. A job without the branch of a release would wait in the lane of the live checks for each of them, to be refused there.
  // The checks ask for nothing of the upgrades before them: where an upgrade failed, or found no build to start from, the release is checked all the same.
  test("each job takes the branch of a release alone, the one the guard of the called job admits, and the checks ask no more than that", () => {
    const asked = BOTH.map((kind) => [RELEASE.jobs[RELEASE_JOBS[kind]]?.if, RELEASE.jobs[ADVICE_JOBS[kind]]?.if, RELEASE.jobs[CHECKS_JOBS[kind]]?.if]);
    const after = `\${{ !cancelled() && github.head_ref == '${RELEASE_BRANCH}' }}`;

    expect({ asked, jobs: Object.keys(RELEASE.jobs).length }).toEqual({
      asked: BOTH.map(() => [`github.head_ref == '${RELEASE_BRANCH}'`, after, after]),
      jobs: 3 * BOTH.length,
    });
  });
});
