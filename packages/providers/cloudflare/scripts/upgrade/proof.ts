// Say whether the live upgrade ran green on both kinds of install, for the commit of main a release is cut from.
//
//   the pull request of a release -> the commit of main its branch stands on -> for the workflow of each kind:
//     a run by hand of that commit that ended green, and whose job `upgrade` ended green   -> one line
//     no such run                                                                          -> an error that says how to make one, and exit 1
//
// The upgrade itself cannot run here: a run of main alone reads the test accounts' secrets. So this reads what such a run left, with no secret of its own.

import { runGh } from "../live/gate";

/** The workflow of each kind of install, and what a line calls the kind. */
const WORKFLOWS = [
  { file: "live-checks.yml", name: "Live Checks", kind: "with a domain" },
  { file: "live-checks-account-address.yml", name: "Live Checks (account address)", kind: "without a domain" },
] as const;

/** How the name of the upgrade's job ends in a run: the calling job's name stands before it. */
const UPGRADE_JOB = " / upgrade";

/** How a job that ended green is told. */
const GREEN = "success";

/** What the proof reads. */
interface Proof {
  /** The repository, as `owner/name`. */
  readonly repository: string;

  /** The tip of the branch the release goes to. */
  readonly base: string;

  /** The tip of the release's own branch. */
  readonly head: string;

  /** Runs `gh` with these arguments and answers what it printed, or `undefined` when it failed. */
  readonly gh: (args: readonly string[]) => Promise<string | undefined>;
}

/** How the proof ended: the exit code of the step and its lines. */
interface Ending {
  readonly code: 0 | 1;
  readonly lines: readonly string[];
}

/** The green run of one workflow whose upgrade ended green, for a commit; `null` where there is none, and `undefined` where GitHub did not say. */
async function upgradedIn(proof: Proof, file: string, sha: string): Promise<string | null | undefined> {
  const query = `event=workflow_dispatch&branch=main&head_sha=${sha}&status=${GREEN}&per_page=100`;
  const listed = await proof.gh(["api", "--paginate", `repos/${proof.repository}/actions/workflows/${file}/runs?${query}`, "--jq", ".workflow_runs[].id"]);
  if (listed === undefined) return undefined;

  for (const run of listed.split("\n").filter((id) => id !== "")) {
    const jobs = ["api", "--paginate", `repos/${proof.repository}/actions/runs/${run}/jobs?per_page=100`, "--jq", `.jobs[] | select(.name | endswith("${UPGRADE_JOB}")) | .conclusion`];
    const ended = await proof.gh(jobs);
    if (ended === undefined) return undefined;

    if (ended.trim() === GREEN) return run;
  }

  return null;
}

/**
 * Look for a green live upgrade of each kind of install, for the commit of main a release's branch stands on.
 *
 * @returns exit code 0 and one line a kind once both are there; else exit code 1, with an error for each kind that has none
 */
export async function proveUpgrades(proof: Proof): Promise<Ending> {
  const stands = await proof.gh(["api", `repos/${proof.repository}/compare/${proof.base}...${proof.head}`, "--jq", ".merge_base_commit.sha"]);
  const sha = stands?.trim() ?? "";
  if (sha === "") return { code: 1, lines: ["::error::GitHub did not say which commit of main the release stands on"] };

  const lines: string[] = [];
  let code: Ending["code"] = 0;

  for (const { file, name, kind } of WORKFLOWS) {
    const run = await upgradedIn(proof, file, sha);
    if (typeof run === "string") {
      lines.push(`upgrade of an install ${kind}: green in run ${run} of ${sha}`);
      continue;
    }

    code = 1;
    const none = `no green live upgrade of an install ${kind} for ${sha}: run the workflow "${name}" by hand on main with \`upgrade\` ticked, then run this job again`;
    lines.push(`::error::${run === undefined ? `GitHub did not say whether an install ${kind} was upgraded for ${sha}: run this job again` : none}`);
  }

  return { code, lines };
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);

  return value;
}

if (import.meta.main) {
  const ending = await proveUpgrades({ repository: required(process.env, "GITHUB_REPOSITORY"), base: required(process.env, "BASE_SHA"), head: required(process.env, "HEAD_SHA"), gh: runGh });

  for (const line of ending.lines) console.log(line);
  process.exitCode = ending.code;
}
