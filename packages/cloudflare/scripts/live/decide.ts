// Decide whether a green main reaches the test install: `run` when a file changed that can change what is deployed or how it is checked, `skip` when none did.
//
//   the last time a run made the install match main, and that run ended green -> the files of every commit from its own to this one -> the table below
//
// It calls GitHub and git, and never Cloudflare. Anything it cannot know is `run`.
// Step output: `verdict` (`run` or `skip`).

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import * as v from "valibot";

import { type Ask, askGitHub, liveRuns } from "./util";

/** The repository's folder. */
const ROOT = join(import.meta.dir, "..", "..", "..", "..");

/** The jobs of the workflow that touch the install, each with the step that does it. Only a deploy changes what the install runs. */
const TOUCHING: Readonly<Record<string, { readonly step: string; readonly deploys: boolean }>> = {
  live: { step: "Make the test install match main", deploys: true },
  reset: { step: "Put the test install back", deploys: false },
};

/** How much of a commit's name a line shows. */
const SHORT = 7;

/** Every character that would end a line of the log. */
const CONTROL = /\p{Cc}/gu;

/** The one table: every file of the repository is in a row. A file in a `run` row and a `skip` row runs, and so does a file in no row. */
const TABLE: readonly Rule[] = [
  { files: "packages/{app,cli,cloudflare,core,demo}/**", verdict: "run", holds: "the Worker, the provider code, the CLI that publishes the samples, the demo, and the live scripts" },
  { files: "demo/**", verdict: "run", holds: "the sample sites a reset publishes" },
  { files: "tests/live/**", verdict: "run", holds: "the live checks" },
  { files: ".github/workflows/live-checks.yml", verdict: "run", holds: "this workflow" },
  { files: ".github/actions/setup/**", verdict: "run", holds: "the action this workflow installs with" },
  { files: "{wrangler.jsonc,package.json,bun.lock,.bun-version,tsconfig*}", verdict: "run", holds: "the Worker's configuration, the lockfile, and the toolchain pins" },
  { files: ".gitattributes", verdict: "run", holds: "the line endings of every file checked out" },
  { files: "{website,docs,brand,skills}/**", verdict: "skip", holds: "pages and pictures no install serves" },
  { files: "*.md", verdict: "skip", holds: "the pages at the root" },
  { files: ".github/**", verdict: "skip", holds: "the other workflows, their scripts, and the repository's settings" },
  { files: ".githooks/**", verdict: "skip", holds: "the hooks of a clone" },
  { files: "tests/{fuzz,release-pipeline,support}/**", verdict: "skip", holds: "tests CI runs with no install" },
  { files: "tests/*.test.ts", verdict: "skip", holds: "the guards of the tree" },
  {
    files: "{.editorconfig,.gitignore,.gitleaks.toml,.repo-platform.yml,.typography-allow,.yamllint,biome.json,biome.local.jsonc,knip.json,lychee.toml,.release-please-manifest.json,release-please-config.json}",
    verdict: "skip",
    holds: "the settings of lint, review, and release tools",
  },
];

/** Each row with its pattern compiled. */
const ROWS: readonly (readonly [glob: Bun.Glob, rule: Rule])[] = TABLE.map((rule) => [new Bun.Glob(rule.files), rule]);

/** The jobs of one run, of every attempt, each with its steps and when each step started. */
const Jobs = v.object({
  jobs: v.array(
    v.object({
      name: v.string(),
      run_attempt: v.number(),
      conclusion: v.nullable(v.string()),
      steps: v.optional(v.array(v.object({ name: v.string(), conclusion: v.nullable(v.string()), started_at: v.optional(v.nullable(v.string()), null) })), []),
    }),
  ),
});

/** One row of the table: a pattern of paths from the root, what a change to them comes to, and what they hold. */
interface Rule {
  readonly files: string;
  readonly verdict: "run" | "skip";
  readonly holds: string;
}

/** What a run does, and why in one line. */
interface Decision {
  readonly verdict: "run" | "skip";
  readonly reason: string;
}

/** The commit the install was last made from, or why nobody knows it. */
type Base = { readonly sha: string } | { readonly unknown: string };

/** One time a job's step touched the install: the run's commit, when it started, whether the job ended green, and whether it was a deploy. */
interface Touch {
  readonly sha: string;
  readonly at: string;
  readonly green: boolean;
  readonly deploys: boolean;
}

/** The two things asked outside the process. */
interface Tools {
  /** GitHub, for the runs of the workflow and their jobs. */
  readonly ask: Ask;

  /** One git command in the checkout. */
  readonly git: (args: readonly string[]) => { readonly code: number; readonly out: string };
}

/** The variables of a run. */
type Environment = Readonly<Record<string, string | undefined>>;

/** Run git in the checkout this file is in. */
function runGit(args: readonly string[]): { code: number; out: string } {
  const ran = Bun.spawnSync(["git", "-C", ROOT, ...args], { stdout: "pipe", stderr: "ignore" });

  return { code: ran.exitCode, out: ran.stdout.toString() };
}

/** The start of a commit's name, enough to find it by. */
function short(sha: string): string {
  return sha.slice(0, SHORT);
}

/**
 * Find the row of the table a file is in.
 *
 * @param path - from the repository's root, with forward slashes
 * @returns a `run` row before a `skip` row, or `undefined` for a file no row names
 */
export function ruleFor(path: string): Rule | undefined {
  const named = ROWS.flatMap(([glob, rule]) => (glob.match(path) ? [rule] : []));

  return named.find((rule) => rule.verdict === "run") ?? named[0];
}

/**
 * Decide from the files changed since the commit the install was last made from.
 *
 * @param since - that commit
 * @returns `skip` only when every file is in a `skip` row; the reason names the first file that runs, or counts the files that do not
 */
export function decide(since: string, changed: readonly string[]): Decision {
  for (const path of changed) {
    const rule = ruleFor(path);
    if (rule === undefined) return { verdict: "run", reason: `${path} changed since ${short(since)}, and no row of the table names it` };

    if (rule.verdict === "run") return { verdict: "run", reason: `${path} changed since ${short(since)}: ${rule.holds}` };
  }

  const example = changed[0] === undefined ? "" : `, e.g. ${changed[0]}`;

  return { verdict: "skip", reason: `no file that reaches the test install changed since ${short(since)} (${changed.length} files${example})` };
}

/** Every time one run touched the install, in any attempt but the one that asks. A job that never reached its step left the install as it was. */
async function touchesOf(env: Environment, ask: Ask, run: { readonly id: number; readonly head_sha: string }): Promise<Touch[]> {
  const { jobs } = v.parse(Jobs, await ask(`repos/${env.GITHUB_REPOSITORY}/actions/runs/${run.id}/jobs?filter=all&per_page=100`));
  const asks = (attempt: number): boolean => String(run.id) === env.GITHUB_RUN_ID && String(attempt) === (env.GITHUB_RUN_ATTEMPT ?? "1");

  return jobs.flatMap((job) => {
    const touching = TOUCHING[job.name];
    const step = job.steps.find((candidate) => candidate.name === touching?.step);
    if (touching === undefined || step === undefined || asks(job.run_attempt) || step.started_at === null || step.conclusion === "skipped") return [];

    return [{ sha: run.head_sha, at: step.started_at, green: step.conclusion === "success" && job.conclusion === "success", deploys: touching.deploys }];
  });
}

/** The commit of the last deploy, when its job ended green and no reset after it failed. */
async function lastDeployed(env: Environment, ask: Ask): Promise<Base> {
  // A run whose every job was skipped touched nothing.
  const runs = (await liveRuns(env, ask)).filter((run) => run.conclusion !== "skipped");
  const touches = (await Promise.all(runs.map((run) => touchesOf(env, ask, run)))).flat();
  // The lane lets one job touch the install at a time, so the step that started last is the last touch.
  const [last] = touches.sort((one, other) => Date.parse(other.at) - Date.parse(one.at));
  const deploy = touches.find((touch) => touch.deploys);
  if (last === undefined || deploy === undefined) return { unknown: "none of the newest runs made the test install match main" };

  const red = [last, deploy].find((touch) => !touch.green);
  if (red !== undefined) return { unknown: `the last ${red.deploys ? "run" : "reset"} that touched the test install, of ${short(red.sha)}, did not end green` };

  return { sha: deploy.sha };
}

/** The files of every commit after one, up to the checkout, or `undefined` when that commit is not in the checkout's history. A file changed and put back is listed, and a renamed one under both names. */
function changedSince(git: Tools["git"], sha: string): readonly string[] | undefined {
  if (git(["merge-base", "--is-ancestor", sha, "HEAD"]).code !== 0) return undefined;

  const listed = git(["log", "--name-only", "--no-renames", "-m", "--format=", "-z", `${sha}..HEAD`]);
  if (listed.code !== 0) return undefined;

  return [...new Set(listed.out.split(/[\0\n]/).filter((path) => path !== ""))];
}

/** Every step in order: the event, the last deploy, the files changed since, the table. */
async function reach(env: Environment, tools: Tools): Promise<Decision> {
  if (env.GITHUB_EVENT_NAME !== "workflow_run") return { verdict: "run", reason: "the run was started by hand" };

  const base = await lastDeployed(env, tools.ask);
  if ("unknown" in base) return { verdict: "run", reason: base.unknown };

  const changed = changedSince(tools.git, base.sha);
  if (changed === undefined) return { verdict: "run", reason: `${short(base.sha)}, the commit of the last green deploy, is not in the history of main` };

  return decide(base.sha, changed);
}

/**
 * Decide for this run, and tell the log, the step summary, and the step's output.
 *
 * @param env - the run's own variables: the event, the repository, the run's id, and where the summary and the output go
 * @returns the exit code, 0 for either verdict: a decision that could not be made is `run`
 */
export async function decideLive(env: Environment, tools: Tools = { ask: askGitHub, git: runGit }): Promise<number> {
  const decision = await reach(env, tools).catch((error: unknown): Decision => ({ verdict: "run", reason: `the last run could not be read (${String(error)})` }));
  const words = decision.verdict === "skip" ? "Live checks skipped" : "Live checks run";
  const line = `${words}: ${decision.reason}`.replace(CONTROL, " ");

  if (decision.verdict === "skip") core.notice(line);
  else console.log(line);

  if (env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);

  if (env.GITHUB_OUTPUT !== undefined) core.setOutput("verdict", decision.verdict);

  return 0;
}

if (import.meta.main) process.exitCode = await decideLive(process.env);
