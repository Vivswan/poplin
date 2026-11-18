// Say whether this run may reach a test account, and stop the job when it may not.
//
//   a run of main                                                                                    -> admitted
//   the pull request of a release: the release's branch, of this repository, opened by the release bot -> admitted
//   any other run                                                                                    -> an error that names each condition that failed, and exit 1
//
// Every job that names the environment of a test account runs this before its first step that is handed a secret.
// The `if:` of the job asks the same of GitHub's own expressions; this reads the file of the event.

import { readFileSync } from "node:fs";

/** The ref of a run of main. */
export const MAIN = "refs/heads/main";

/** The event of a pull request's run. */
export const PULL_REQUEST = "pull_request";

/** The branch the release bot keeps the next release on. */
export const RELEASE_BRANCH = "release-please--branches--main";

/** The account that opens the pull request of a release. */
export const RELEASE_BOT = "github-actions[bot]";

/** A run, as GitHub describes it to a step. */
interface Run {
  /** The ref the run is of. */
  readonly ref: string;

  /** The event that started it. */
  readonly event: string;

  /** The repository it runs in, as `owner/name`. */
  readonly repository: string;

  /** The pull request of the event: its branch, the repository of that branch, and who opened it. Each is `undefined` where the event names none. */
  readonly pull: { readonly branch: string | undefined; readonly repository: string | undefined; readonly author: string | undefined };
}

/** How the asking ended: the exit code of the step and its lines. */
interface Ending {
  readonly code: 0 | 1;
  readonly lines: readonly string[];
}

/** One line for a value that is not the one asked for; nothing where it is. */
function unlike(what: string, found: string | undefined, wanted: string): readonly string[] {
  return found === wanted ? [] : [`${what} is ${found === undefined ? "not named" : `\`${found}\``}, not \`${wanted}\``];
}

/**
 * Say whether a run may reach a test account.
 *
 * @returns exit code 0 and one line for a run of main or the pull request of a release; else exit code 1 and one error that names every condition that failed
 */
export function admit(run: Run): Ending {
  if (run.ref === MAIN) return { code: 0, lines: ["Admitted: a run of main"] };

  const failed = [
    ...unlike("the event", run.event, PULL_REQUEST),
    ...unlike("the branch of the pull request", run.pull.branch, RELEASE_BRANCH),
    ...unlike("the repository of that branch", run.pull.repository, run.repository),
    ...unlike("the account that opened the pull request", run.pull.author, RELEASE_BOT),
  ];
  if (failed.length === 0) return { code: 0, lines: ["Admitted: the pull request of a release"] };

  return { code: 1, lines: [`::error::this run may not reach a test account: its ref is \`${run.ref}\`, not \`${MAIN}\`, and as the pull request of a release ${failed.join("; ")}`] };
}

/** The text at a path of names inside a parsed file; `undefined` where a name is absent or the end is no text. */
function textAt(value: unknown, path: readonly string[]): string | undefined {
  let found = value;

  for (const name of path) {
    if (typeof found !== "object" || found === null) return undefined;

    found = (found as Readonly<Record<string, unknown>>)[name];
  }

  return typeof found === "string" ? found : undefined;
}

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);

  return value;
}

if (import.meta.main) {
  const event: unknown = JSON.parse(readFileSync(required(process.env, "GITHUB_EVENT_PATH"), "utf8"));
  const pull = {
    branch: textAt(event, ["pull_request", "head", "ref"]),
    repository: textAt(event, ["pull_request", "head", "repo", "full_name"]),
    author: textAt(event, ["pull_request", "user", "login"]),
  };
  const ending = admit({ ref: required(process.env, "GITHUB_REF"), event: required(process.env, "GITHUB_EVENT_NAME"), repository: required(process.env, "GITHUB_REPOSITORY"), pull });

  for (const line of ending.lines) console.log(line);
  process.exitCode = ending.code;
}
