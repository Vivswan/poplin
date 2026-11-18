// The build a live upgrade starts from is found in the history of the checkout and in the versions npm holds, which a test stands in for with a repository of its own and a list.
// Without it an upgrade from a pre-release starts from the commit under test itself, or from a build older than the last release, and passes having compared nothing.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git } from "../../../../../tests/migrations/support/trees";
import { olderFrom } from "../../migrations/older-from";

/** What makes a commit and a tag in a fixture repository read nothing from the machine: a fixed identity, no signing, and no hook. */
const SEALED: readonly string[] = ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.hooksPath="];

/** A repository outside this one; it is removed when the caller's scope ends. */
interface Fixture extends Disposable {
  /** The folder of the repository. */
  readonly root: string;

  /** Makes a commit, tags it where a tag is named, and answers the commit. */
  readonly commit: (tag?: string) => string;

  /** Runs git in the repository, sealed from the machine. */
  readonly git: (args: readonly string[]) => string;
}

function fixture(): Fixture {
  const folder = mkdtempDisposableSync(join(tmpdir(), "older-from-"));
  const sealed = (args: readonly string[]): string => git(folder.path, [...SEALED, ...args]);
  sealed(["init", "--quiet", "--template=", "--initial-branch=main"]);

  // Each commit says its own number: two commits alike in all else, made in one second, are one commit.
  let made = 0;

  const commit = (tag?: string): string => {
    made += 1;
    sealed(["commit", "--quiet", "--allow-empty", "--message", `commit ${made}`]);
    if (tag !== undefined) sealed(["tag", tag]);

    return sealed(["rev-parse", "HEAD"]).trim();
  };

  return { root: folder.path, commit, git: sealed, [Symbol.dispose]: () => folder.remove() };
}

/** The version npm holds a pre-release of a commit under: the count orders them. */
function preRelease(count: number, commit: string): string {
  return `0.1.0-main.${count}.20260101.g${commit.slice(0, 7)}`;
}

describe("the build a live upgrade starts from", () => {
  test("from the last release: the release's tag, with how far behind it is; a checkout with no such tag is told to fetch them, whichever start is asked for, where an upgrade with nothing to start from would pass", () => {
    using repository = fixture();
    const untagged = repository.commit();
    const refusals = (["release", "next"] as const).map((from) => () => olderFrom(repository.root, from, () => [preRelease(1, untagged)]));
    for (const refusal of refusals) expect(refusal).toThrow(`${repository.root} holds no release tag among its ancestors: fetch the tags from poplin's repository (\`git fetch --tags <repository>\`)`);
    const released = repository.commit("v0.1.0");
    repository.commit();
    repository.commit();

    expect(olderFrom(repository.root, "release", () => undefined)).toEqual({ kind: "build", ref: "v0.1.0", line: `Older build: v0.1.0 (${released.slice(0, 7)}), 2 commits behind this one` });
  });

  test("from a pre-release: the newest one of an ancestor is taken, and this commit's own, one of no ancestor, and one of a commit the checkout lacks are passed over", () => {
    using repository = fixture();
    repository.commit("v0.0.1");
    const first = repository.commit();
    const before = repository.commit();
    repository.git(["checkout", "--quiet", "-b", "side"]);
    const aside = repository.commit();
    repository.git(["checkout", "--quiet", "main"]);
    const head = repository.commit();
    const held = [preRelease(1, first), preRelease(2, before), preRelease(3, aside), preRelease(4, "0".repeat(40)), preRelease(5, head), "0.1.0", "0.2.0-rc.1"];
    const refused = (versions: readonly string[]): unknown => olderFrom(repository.root, "next", () => versions);

    expect({ taken: refused(held), own: refused([preRelease(5, head)]), aside: refused([preRelease(3, aside)]), lacking: refused([preRelease(4, "0".repeat(40))]), none: refused(["0.1.0"]) }).toEqual({
      taken: { kind: "build", ref: before, line: `Older build: ${preRelease(2, before)} (${before.slice(0, 7)}), 1 commit behind this one` },
      own: { kind: "none", line: `No pre-release on npm is an earlier build of this one: the newest, ${preRelease(5, head)}, is this commit's own.` },
      aside: { kind: "none", line: `No pre-release on npm is an earlier build of this one: the newest, ${preRelease(3, aside)}, is of a commit that is no ancestor of this one.` },
      lacking: { kind: "none", line: `No pre-release on npm is an earlier build of this one: the newest, ${preRelease(4, "0".repeat(40))}, is of a commit this checkout does not hold.` },
      none: { kind: "none", line: "No pre-release is on npm: there is no earlier build to upgrade from." },
    });
  });

  // Drift: the run of a pull request is of a commit that joins the branch to main's tip, so the pre-release of that tip is the code under test, less what the branch adds.
  test("from a pre-release, on a commit that joins two: the commits it joins are passed over, and the build before them is taken", () => {
    using repository = fixture();
    repository.commit("v0.0.1");
    const before = repository.commit();
    const tip = repository.commit();
    repository.git(["checkout", "--quiet", "-b", "release"]);
    repository.commit();
    repository.git(["checkout", "--quiet", "main"]);
    repository.git(["merge", "--quiet", "--no-ff", "--message", "a merge", "release"]);

    expect([olderFrom(repository.root, "next", () => [preRelease(1, before), preRelease(2, tip)]), olderFrom(repository.root, "next", () => [preRelease(2, tip)])]).toEqual([
      { kind: "build", ref: before, line: `Older build: ${preRelease(1, before)} (${before.slice(0, 7)}), 3 commits behind this one` },
      { kind: "none", line: `No pre-release on npm is an earlier build of this one: the newest, ${preRelease(2, tip)}, is of the commit this run is cut from.` },
    ]);
  });

  test("from a pre-release, once a release is cut: one of the release, of a commit before it, or of a branch that left before it is passed over, which the upgrade from the release covers", () => {
    using repository = fixture();
    const old = repository.commit();
    repository.git(["checkout", "--quiet", "-b", "side"]);
    const aside = repository.commit();
    repository.git(["checkout", "--quiet", "main"]);
    const released = repository.commit("v0.1.0");
    const after = repository.commit();
    repository.git(["merge", "--quiet", "--no-ff", "--message", "a merge", "side"]);
    repository.commit();
    const start = (versions: readonly string[]): unknown => olderFrom(repository.root, "next", () => versions);
    const before = [preRelease(1, old), preRelease(2, released), preRelease(3, aside)];

    expect([start([...before, preRelease(4, after)]), start(before)]).toEqual([
      { kind: "build", ref: after, line: `Older build: ${preRelease(4, after)} (${after.slice(0, 7)}), 3 commits behind this one` },
      { kind: "none", line: `No pre-release on npm is an earlier build of this one: the newest, ${preRelease(3, aside)}, is no newer than the last release, v0.1.0.` },
    ]);
  });
});
