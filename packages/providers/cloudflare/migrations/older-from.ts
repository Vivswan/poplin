// Which build a live upgrade starts from, by what its run asks for.
//
//   release   the last release among the ancestors of the checkout                 -> its upgrade blocks
//   next      the newest pre-release on npm that is an earlier build of this one   -> its upgrade only advises
//
// A pre-release says its commit in its version, `0.1.0-main.<count>.<date>.g<commit>`. It is an earlier build when its commit is:
//
//   an ancestor of this commit, and not this commit
//   none of the commits a merge commit joins: a pull request's run is of such a commit, and what it joins is the code under test
//   a descendant of the last release, which the run that asks for `release` starts from

import { git, lastRelease } from "../../../../tests/migrations/support/trees";

/** What a run may ask an upgrade to start from. */
const FROM = ["release", "next"] as const;

/** The variable a run names its start in. */
const FROM_VARIABLE = "POPLIN_UPGRADE_FROM";

/** What a run that asks for a pre-release says while npm holds none. */
const NO_PRE_RELEASE = "No pre-release is on npm: there is no earlier build to upgrade from.";

/** The version of a pre-release, with the commit it was built from. */
const PRE_RELEASE = /^\d+\.\d+\.\d+-main\.\d+\.\d+\.g([0-9a-f]{7,40})$/;

/** How many characters of a commit a line shows. */
const SHOWN = 7;

/** What a run may ask an upgrade to start from. */
export type From = (typeof FROM)[number];

/** The build an upgrade starts from, or the line that says why there is none. */
export type Start = { readonly kind: "build"; readonly ref: string; readonly line: string } | { readonly kind: "none"; readonly line: string };

/** A checkout, as far as an earlier build is told from it. */
interface Checkout {
  /** The folder of the checkout. */
  readonly root: string;

  /** The commit of the checkout. */
  readonly head: string;

  /** The commits the checkout's commit joins, when it is a merge commit. */
  readonly joined: readonly string[];

  /** The last release among its ancestors. */
  readonly release: string;
}

/** Ask git, and answer nothing where it fails: a commit the checkout does not hold, or one that is no ancestor. */
function ask(root: string, args: readonly string[]): string | undefined {
  try {
    return git(root, args).trim();
  } catch {
    return undefined;
  }
}

/** The line that names the build an upgrade starts from. */
function olderLine(root: string, name: string, ref: string): string {
  const commit = git(root, ["rev-parse", `${ref}^{commit}`]).trim();
  const behind = Number(git(root, ["rev-list", "--count", `${commit}..HEAD`]).trim());

  return `Older build: ${name} (${commit.slice(0, SHOWN)}), ${behind} ${behind === 1 ? "commit" : "commits"} behind this one`;
}

/** Why a pre-release is no earlier build of a checkout: nothing where it is one. */
function refusal(checkout: Checkout, commit: string | undefined): string | undefined {
  const { root, head, joined } = checkout;
  if (commit === undefined) return "of a commit this checkout does not hold";

  if (commit === head) return "this commit's own";

  if (joined.includes(commit)) return "of the commit this run is cut from";

  if (ask(root, ["merge-base", "--is-ancestor", commit, head]) === undefined) return "of a commit that is no ancestor of this one";

  const release = git(root, ["rev-parse", `${checkout.release}^{commit}`]).trim();
  if (release === commit || ask(root, ["merge-base", "--is-ancestor", release, commit]) === undefined) return `no newer than the last release, ${checkout.release}`;

  return undefined;
}

/** The newest pre-release that is an earlier build of a checkout. */
function earlierBuild(root: string, versions: readonly string[]): Start {
  const [head = "", ...parents] = git(root, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ");
  const checkout: Checkout = { root, head, joined: parents.length > 1 ? parents : [], release: lastRelease(root) };
  const newestFirst = versions.filter((version) => PRE_RELEASE.test(version)).sort((one, other) => Bun.semver.order(other, one));
  const [newest] = newestFirst;
  if (newest === undefined) return { kind: "none", line: NO_PRE_RELEASE };

  let why = "";

  for (const version of newestFirst) {
    const commit = ask(root, ["rev-parse", "--verify", "--quiet", `${PRE_RELEASE.exec(version)?.[1]}^{commit}`]);
    const refused = refusal(checkout, commit);
    if (refused === undefined && commit !== undefined) return { kind: "build", ref: commit, line: olderLine(root, version, commit) };

    why ||= refused ?? "";
  }

  return { kind: "none", line: `No pre-release on npm is an earlier build of this one: the newest, ${newest}, is ${why}.` };
}

/**
 * Read what a run asks its upgrade to start from.
 *
 * @throws {Error} the variable names neither start
 */
export function readFrom(env: Readonly<Record<string, string | undefined>>): From {
  const from = FROM.find((known) => known === env[FROM_VARIABLE]);
  if (from === undefined) throw new Error(`${FROM_VARIABLE} must be one of: ${FROM.join(", ")}`);

  return from;
}

/**
 * Find the build an upgrade starts from.
 *
 * @param root - the checkout, with its whole history
 * @param versions - asks npm for every version of the command; nothing where npm did not answer
 * @returns the tag or the commit of the build with the line that names it, or the line that says why there is none
 * @throws {Error} the checkout is shallow or holds no release tag, or npm did not answer
 */
export function olderFrom(root: string, from: From, versions: () => readonly string[] | undefined): Start {
  if (from === "next") {
    const known = versions();
    if (known === undefined) throw new Error("npm did not say which versions of the command it holds");

    return earlierBuild(root, known);
  }

  const release = lastRelease(root);

  return { kind: "build", ref: release, line: olderLine(root, release, release) };
}
