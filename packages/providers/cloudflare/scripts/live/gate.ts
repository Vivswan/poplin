// Wait for the `all-green` job of the CI run that this commit's push to main started, and say how it ended.
//
//   the gate ended `success`                          -> exit 0
//   the gate ended any other way                      -> exit 1: nothing deployed
//   the run ended and holds no gate                   -> exit 1
//   no run yet, no gate yet, a gate at work, no answer -> ask again after the pause
//   the ceiling is reached                            -> exit 1
//
// A job after the gate stops nothing here: the run's own end is read only to tell a gate that is late from one that never comes.

/** The name of the job that is the gate. */
const GATE = "all-green";

/** How long the wait asks before it gives up, in seconds. The step's own timeout is above it, so the wait ends with its own line. */
const CEILING_SECONDS = 1800;

/** The pause between two askings, in seconds. */
const PAUSE_SECONDS = 30;

/** What the wait reads and how it passes time. */
interface Wait {
  /** The commit whose gate is waited for. */
  readonly sha: string;

  /** The repository of the commit, as `owner/name`. */
  readonly repository: string;

  /** Runs `gh` with these arguments and answers what it printed, or `undefined` when it failed. */
  readonly gh: (args: readonly string[]) => Promise<string | undefined>;

  /** The seconds passed since some fixed moment. */
  readonly now: () => number;

  /** Lets this many seconds pass. */
  readonly pause: (seconds: number) => Promise<void>;
}

/** How the wait ended: the exit code of the step and its last line. */
interface Ending {
  readonly code: 0 | 1;
  readonly line: string;
}

/** The CI run of the commit: its id and whether it ended. `undefined` while GitHub lists none or does not answer. */
async function readRun(wait: Wait): Promise<{ readonly id: string; readonly ended: boolean } | undefined> {
  const listed = await wait.gh([
    ...["run", "list", "--workflow", "ci.yml", "--event", "push", "--branch", "main", "--commit", wait.sha, "--limit", "1"],
    ...["--json", "databaseId,status", "--jq", '.[] | "\\(.databaseId) \\(.status)"'],
  ]);
  const [id, status] = (listed ?? "").trim().split(" ");
  if (id === undefined || id === "") return undefined;

  return { id, ended: status === "completed" };
}

/** How the gate of a run ended: its conclusion, `pending` while it works, `` while the run holds no such job, and `undefined` when GitHub did not answer. */
async function readGate(wait: Wait, run: string): Promise<string | undefined> {
  const conclusion = await wait.gh([
    ...["api", "--paginate", `repos/${wait.repository}/actions/runs/${run}/jobs?per_page=100`],
    ...["--jq", `.jobs[] | select(.name == "${GATE}") | .conclusion // "pending"`],
  ]);

  return conclusion?.trim();
}

/** One asking: how the wait ends, or `undefined` when it goes on. */
async function ask(wait: Wait): Promise<Ending | undefined> {
  const run = await readRun(wait);
  if (run === undefined) return undefined;

  const gate = await readGate(wait, run.id);
  if (gate === undefined || gate === "pending") return undefined;

  if (gate === "success") return { code: 0, line: `${GATE} ended success in CI run ${run.id}` };

  if (gate !== "") return { code: 1, line: `::error::${GATE} ended ${gate} in CI run ${run.id} of ${wait.sha}: nothing deployed` };

  if (run.ended) return { code: 1, line: `::error::CI run ${run.id} of ${wait.sha} ended with no ${GATE} check: nothing deployed` };

  return undefined;
}

/** Runs `gh` as a child with this process's environment, its errors on this process's own. A `gh` that does not start is one that failed. */
async function runGh(args: readonly string[]): Promise<string | undefined> {
  try {
    const child = Bun.spawn(["gh", ...args], { stdin: "ignore", stdout: "pipe", stderr: "inherit" });
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

/**
 * Wait for the gate of a commit's CI run to end.
 *
 * @returns the step's exit code and its last line: an error annotation unless the gate ended green
 */
export async function waitForGate(wait: Wait): Promise<Ending> {
  const started = wait.now();

  while (wait.now() - started < CEILING_SECONDS) {
    const ending = await ask(wait);
    if (ending !== undefined) return ending;

    await wait.pause(PAUSE_SECONDS);
  }

  return { code: 1, line: `::error::${GATE} of ${wait.sha} did not end within ${CEILING_SECONDS / 60} minutes: nothing deployed` };
}

if (import.meta.main) {
  const ending = await waitForGate({
    sha: required(process.env, "GITHUB_SHA"),
    repository: required(process.env, "GITHUB_REPOSITORY"),
    gh: runGh,
    now: () => performance.now() / 1000,
    pause: (seconds) => Bun.sleep(seconds * 1000),
  });

  console.log(ending.line);
  process.exitCode = ending.code;
}
