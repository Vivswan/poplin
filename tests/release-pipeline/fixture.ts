/** What the release pipeline tests share: a hand-written commit graph, and a git checkout, a registry, and an npm that live outside the repository. */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Ancestry, Packument } from "../../.github/scripts/release-pipeline/records.js";

/** The pipeline's entry script, run as a workflow step runs it. */
const ENTRY = join(import.meta.dir, "../../.github/scripts/release-pipeline.ts");

/** Late on the 13th in New York is the 14th in UTC: the source commit, a merge, is stamped with it. */
const SOURCE_COMMITTED = "2026-09-13T23:30:00-04:00";

/** The date the source commit's version carries. */
export const SOURCE_DATE = "20260914";

/** No global and no system config, and a fixed identity: a fixture commit reads nothing from the machine it runs on. */
const SEALED_GIT = {
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.com",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.com",
};

/** The variables a step reads; a CI run of these tests carries its own, which must not reach a fixture step. */
const STEP_VARIABLES = new Set(["GITHUB_SHA", "TAG", "ACTIONS_ID_TOKEN_REQUEST_URL", "NPM_REGISTRY_URL", "NPM_CONFIRM_PAUSE_MS"]);

/** One registry answer: a status, and a JSON body when it has one. */
export interface Answer {
  status: number;
  body?: unknown;
}

/** A checkout at main's second commit, the merge of a two-commit topic, with one commit after it on main and one on a branch off the first. */
export interface Checkout {
  /** The temp directory holding the repository and its shallow clone. */
  root: string;

  /** The repository, HEAD detached at `source`. */
  work: string;

  /** Main's first commit. */
  seed: string;

  /** Main's second commit along first parents, fourth by plain count: the one whose build is published. */
  source: string;

  /** Main's third commit. */
  after: string;

  /** A commit on a branch off `seed`, never merged. */
  side: string;
}

/** What a subcommand left behind. */
export interface StepResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** The environment without the caller's GIT_* variables, which would send a spawned git into the caller's repository. */
function sealedEnv(extra: Record<string, string>): Record<string, string> {
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("GIT_") && !STEP_VARIABLES.has(entry[0]),
  );

  return { ...Object.fromEntries(inherited), ...SEALED_GIT, ...extra };
}

function git(cwd: string, env: Record<string, string>, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: sealedEnv(env) }).trim();
}

function write(cwd: string, file: string, content: unknown): void {
  mkdirSync(dirname(join(cwd, file)), { recursive: true });
  writeFileSync(join(cwd, file), typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
}

function commit(cwd: string, subject: string): string {
  git(cwd, {}, "add", "-A");
  git(cwd, {}, "commit", "--quiet", "-m", subject);

  return git(cwd, {}, "rev-parse", "HEAD");
}

/** A commit graph written by hand, child to parents; a short name resolves when exactly one commit opens with it. */
export function graphAncestry(parents: Record<string, string[]>): Ancestry {
  const reaches = (from: string, target: string): boolean =>
    from === target || (parents[from] ?? []).some((parent) => reaches(parent, target));

  return {
    resolve: (name) => {
      const matches = Object.keys(parents).filter((sha) => sha.startsWith(name));
      const [only] = matches;
      return matches.length === 1 && only !== undefined ? only : null;
    },
    isAncestor: (ancestor, descendant) => reaches(descendant, ancestor),
  };
}

/** A registry record holding the versions, with the dist-tags given. */
export function record(versions: string[], tags: Record<string, string>): Packument {
  return { versions: Object.fromEntries(versions.map((version) => [version, {}])), "dist-tags": tags };
}

/**
 * Runs `body` against a checkout of a repository shaped like this one: the manifest at the root, the package in packages/cli.
 *
 * @param released - the version the manifest and the package's package.json carry
 */
export async function withCheckout<T>(released: string, body: (checkout: Checkout) => Promise<T>): Promise<T> {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "release-pipeline-"));
  const root = scratch.path;
  const work = join(root, "work");

  mkdirSync(work);
  git(work, {}, "init", "--quiet", "--initial-branch=main");
  write(work, ".release-please-manifest.json", { ".": released });
  write(work, "package.json", { name: "fixture-workspace", private: true, workspaces: ["packages/*"] });
  write(work, "packages/cli/package.json", { name: "poplin", version: released });
  const seed = commit(work, "chore: seed");

  git(work, {}, "checkout", "--quiet", "-b", "topic");
  write(work, "packages/cli/index.js", "export const answer = 0;\n");
  commit(work, "feat: answer, part one");
  write(work, "packages/cli/index.js", "export const answer = 1;\n");
  commit(work, "feat: answer, part two");
  git(work, {}, "checkout", "--quiet", "main");
  git(work, { GIT_COMMITTER_DATE: SOURCE_COMMITTED }, "merge", "--quiet", "--no-ff", "--no-edit", "topic");
  const source = git(work, {}, "rev-parse", "HEAD");

  write(work, "packages/cli/index.js", "export const answer = 2;\n");
  const after = commit(work, "feat: a better answer");

  git(work, {}, "checkout", "--quiet", "-b", "side", seed);
  write(work, "packages/cli/side.js", "export const side = 1;\n");
  const side = commit(work, "feat: off main");

  git(work, {}, "checkout", "--quiet", "--detach", source);

  return await body({ root, work, seed, source, after, side });
}

/** A depth-one clone of the checkout's main, beside it; returns its path and its HEAD. */
export function shallowClone(checkout: Checkout): { dir: string; head: string } {
  const dir = join(checkout.root, "shallow");
  git(checkout.root, {}, "clone", "--quiet", "--depth", "1", "--branch", "main", `file://${checkout.work}`, dir);

  return { dir, head: git(dir, {}, "rev-parse", "HEAD") };
}

/**
 * Serves the answers in order on a local port, the last one repeated, and records each request as its path and query.
 *
 * @param body - takes the registry's base URL and the live list of requests
 */
export async function withRegistry<T>(answers: Answer[], body: (url: string, requests: string[]) => Promise<T>): Promise<T> {
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname, search } = new URL(request.url);
      requests.push(pathname + search);
      const answer = answers[Math.min(requests.length, answers.length) - 1] ?? { status: 500 };

      if (answer.body === undefined) {
        return new Response("", { status: answer.status });
      }

      return Response.json(answer.body, { status: answer.status });
    },
  });

  try {
    return await body(`http://127.0.0.1:${server.port}`, requests);
  } finally {
    await server.stop(true);
  }
}

/**
 * Puts a scripted npm first on PATH: `--version` prints the version, and any other call prints itself with the folder
 * it ran in (its last two segments) and the GITHUB_SHA it saw, then exits with `failing.status` when it is the failing command.
 *
 * POSIX only: the fake npm is a `#!/bin/sh` script and PATH is joined with `:`, so the tests that use it run on Linux and macOS.
 *
 * @param body - takes the PATH to run a subcommand with, and a reader of every call but `--version` so far
 */
export async function withNpm<T>(
  options: { version?: string; failing?: { command: string; status: number } },
  body: (path: string, calls: () => string[]) => Promise<T>,
): Promise<T> {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "release-pipeline-npm-"));
  const dir = scratch.path;
  const log = join(dir, "calls.log");
  const fail = options.failing === undefined ? [] : [`[ "$1" = "${options.failing.command}" ] && exit ${options.failing.status}`];
  const script = [
    "#!/bin/sh",
    `if [ "$1" = "--version" ]; then echo "${options.version ?? "11.5.1"}"; exit 0; fi`,
    'line="npm $* (in $(basename "$(dirname "$PWD")")/$(basename "$PWD"), GITHUB_SHA=$GITHUB_SHA)"',
    'echo "$line"',
    `echo "$line" >> "${log}"`,
    ...fail,
    "exit 0",
    "",
  ];

  writeFileSync(join(dir, "npm"), script.join("\n"));
  chmodSync(join(dir, "npm"), 0o755);
  writeFileSync(log, "");

  return await body(`${dir}:${process.env.PATH ?? ""}`, () => readFileSync(log, "utf8").split("\n").filter(Boolean));
}

/** Runs the pipeline's entry as a workflow step would: under bun, in the checkout, with the step's environment. */
export async function subcommand(cwd: string, env: Record<string, string>, ...args: string[]): Promise<StepResult> {
  const child = Bun.spawn([process.execPath, ENTRY, ...args], { cwd, env: sealedEnv(env), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);

  return { stdout, stderr, status };
}
