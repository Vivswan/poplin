// Find the newest commit of main whose gate ended green, and say what a put-back of a test install does with it.
//
//   the runs main's pushes started, newest first -> the first whose `all-green` job ended `success` is the newest green commit
//
//   a push's run, and that commit is its own                 -> nothing written: the job installs the commit it checked out
//   a push's run, and that commit is a newer one             -> `stale=true`: that commit's own run installs it, and this job makes nothing
//   any other run, and that commit is the one checked out    -> nothing written
//   any other run, and that commit is another                -> `sha=<commit>`: the job checks it out, then installs it
//   GitHub did not answer, or no run it lists holds a green gate -> a warning, and nothing written: the job installs the commit it checked out
//
// A push's run is started only after its own gate ended green, so the walk ends at its commit without asking.
// A job after the gate changes nothing here: the gate's own end is read, never the run's.

import * as core from "@actions/core";

/** The name of the job that is the gate. */
const GATE = "all-green";

/** How many of main's newest runs are read: the most one listing holds. */
const RUNS = 100;

/** The event of a run a push started. */
const PUSH = "push";

/** What the search reads. */
interface Search {
  /** The event of this run. */
  readonly event: string;

  /** The repository, as `owner/name`. */
  readonly repository: string;

  /** The commit the job checked out. */
  readonly head: string;

  /** Runs `gh` with these arguments and answers what it printed, or `undefined` when it failed. */
  readonly gh: (args: readonly string[]) => Promise<string | undefined>;
}

/** What the search found: the step's one line, whether it is a warning, and the outputs it writes. */
interface Found {
  readonly line: string;
  readonly warning: boolean;
  readonly outputs: Readonly<Record<string, string>>;
}

/** A commit as a line names it. */
function short(sha: string): string {
  return sha.slice(0, 7);
}

/** The runs main's pushes started, newest first, each as its id and its commit. `undefined` when GitHub did not answer. */
async function readRuns(search: Search): Promise<readonly (readonly [id: string, sha: string])[] | undefined> {
  const listed = await search.gh([
    ...["run", "list", "--repo", search.repository, "--workflow", "ci.yml", "--event", PUSH, "--branch", "main", "--limit", String(RUNS)],
    ...["--json", "databaseId,headSha", "--jq", '.[] | "\\(.databaseId) \\(.headSha)"'],
  ]);
  if (listed === undefined) return undefined;

  return listed.split("\n").flatMap((line) => {
    const [id, sha] = line.trim().split(" ");

    return id === undefined || id === "" || sha === undefined ? [] : [[id, sha] as const];
  });
}

/** Whether the gate of a run ended green. `undefined` when GitHub did not answer. */
async function isGreen(search: Search, run: string): Promise<boolean | undefined> {
  const conclusion = await search.gh([
    ...["api", "--paginate", `repos/${search.repository}/actions/runs/${run}/jobs?per_page=100`],
    ...["--jq", `.jobs[] | select(.name == "${GATE}") | .conclusion // "pending"`],
  ]);

  return conclusion === undefined ? undefined : conclusion.trim() === "success";
}

/** The newest green commit of main: `""` where no run that was read holds a green gate, and `undefined` when GitHub did not answer. */
async function newestGreen(search: Search): Promise<string | undefined> {
  const runs = await readRuns(search);
  if (runs === undefined) return undefined;

  for (const [id, sha] of runs) {
    if (search.event === PUSH && sha === search.head) return sha;

    const green = await isGreen(search, id);
    if (green === undefined) return undefined;

    if (green) return sha;
  }

  return "";
}

/**
 * Find the newest green commit of main and say what the job does with it.
 *
 * @returns the step's line and its outputs: `stale` for a push's run that a newer green commit overtook, `sha` for another run whose checkout is not that commit, and none where the job installs what it checked out
 */
export async function findNewestGreen(search: Search): Promise<Found> {
  const newest = await newestGreen(search);
  if (newest === undefined) return { line: "GitHub did not say which commit of main is the newest green one: installing the commit checked out", warning: true, outputs: {} };

  if (newest === "") return { line: `None of the last ${RUNS} runs of main holds a green gate: installing the commit checked out`, warning: true, outputs: {} };

  if (newest === search.head) return { line: `Newest green commit of main: ${short(newest)}, the one checked out: installing it`, warning: false, outputs: {} };

  if (search.event === PUSH) {
    return { line: `Newest green commit of main: ${short(newest)}, newer than this run's ${short(search.head)}: its own run installs it, nothing is made here`, warning: false, outputs: { stale: "true" } };
  }

  return { line: `Newest green commit of main: ${short(newest)}, not the one checked out (${short(search.head)}): taking it`, warning: false, outputs: { sha: newest } };
}

/** Runs a command as a child with this process's environment, its errors on this process's own. One that does not start is one that failed. */
async function run(command: readonly string[]): Promise<string | undefined> {
  try {
    const child = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
    const [code, printed] = await Promise.all([child.exited, new Response(child.stdout).text()]);

    return code === 0 ? printed : undefined;
  } catch {
    return undefined;
  }
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);

  return value;
}

if (import.meta.main) {
  const head = (await run(["git", "rev-parse", "HEAD"]))?.trim();
  if (head === undefined || head === "") throw new Error("git did not name the commit checked out");

  const found = await findNewestGreen({ event: required(process.env, "GITHUB_EVENT_NAME"), repository: required(process.env, "GITHUB_REPOSITORY"), head, gh: (args) => run(["gh", ...args]) });

  if (found.warning) core.warning(found.line);
  else console.log(found.line);

  for (const [name, value] of Object.entries(found.outputs)) core.setOutput(name, value);
}
