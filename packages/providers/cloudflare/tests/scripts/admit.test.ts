// Which runs may reach a test account, asked of runs a test describes.
// Without it a pull request that is not the release's, or a branch of a fork under the release's name, would be handed the token of a real account.

import { describe, expect, test } from "bun:test";

import { admit, MAIN, PULL_REQUEST, RELEASE_BOT, RELEASE_BRANCH } from "../../scripts/admit";

/** The repository the runs are of. */
const HERE = "example/poplin";

/** The pull request of a release, as its event names it. */
const RELEASE = { branch: RELEASE_BRANCH, repository: HERE, author: RELEASE_BOT };

/** A pull request's run, whose ref is never a branch. */
const PULL = { ref: "refs/pull/9/merge", event: PULL_REQUEST, repository: HERE };

/** The error of a run that is refused, with the conditions that failed. */
function refused(ref: string, failed: readonly string[]): { readonly code: 1; readonly lines: readonly string[] } {
  return { code: 1, lines: [`::error::this run may not reach a test account: its ref is \`${ref}\`, not \`${MAIN}\`, and as the pull request of a release ${failed.join("; ")}`] };
}

describe("the runs that may reach a test account", () => {
  test.each([
    ["a push to main", { ref: MAIN, event: "push", repository: HERE, pull: {} }, { code: 0, lines: ["Admitted: a run of main"] }],
    ["the pull request of a release", { ...PULL, pull: RELEASE }, { code: 0, lines: ["Admitted: the pull request of a release"] }],
    ["a pull request of another branch", { ...PULL, pull: { ...RELEASE, branch: "a-change" } }, refused(PULL.ref, ["the branch of the pull request is `a-change`, not `release-please--branches--main`"])],
    ["a fork's branch under the release's name", { ...PULL, pull: { ...RELEASE, repository: "visitor/poplin" } }, refused(PULL.ref, ["the repository of that branch is `visitor/poplin`, not `example/poplin`"])],
    ["the release's branch in a pull request a person opened", { ...PULL, pull: { ...RELEASE, author: "a-person" } }, refused(PULL.ref, ["the account that opened the pull request is `a-person`, not `github-actions[bot]`"])],
    [
      "a push to the release's branch, whose event names no pull request",
      { ref: `refs/heads/${RELEASE_BRANCH}`, event: "push", repository: HERE, pull: {} },
      refused(`refs/heads/${RELEASE_BRANCH}`, [
        "the event is `push`, not `pull_request`",
        "the branch of the pull request is not named, not `release-please--branches--main`",
        "the repository of that branch is not named, not `example/poplin`",
        "the account that opened the pull request is not named, not `github-actions[bot]`",
      ]),
    ],
  ] as const)("%s", (_what, run, ending) => {
    expect(admit({ ...run, pull: { branch: undefined, repository: undefined, author: undefined, ...run.pull } })).toEqual({ code: ending.code, lines: [...ending.lines] });
  });
});
