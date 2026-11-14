/** The git reads the release pipeline makes in its checkout: one spawn per helper, each with the failure shape its callers judge. */

import { execFileSync } from "node:child_process";
import type { Ancestry, MainPosition } from "./records.js";

function gitFailure(args: string[], error: unknown): Error {
  const stderr = (error as { stderr?: unknown }).stderr;
  const detail = typeof stderr === "string" && stderr.trim() !== "" ? `: ${stderr.trim()}` : "";

  return new Error(`git ${args.join(" ")} failed${detail}`);
}

/**
 * git's trimmed stdout.
 *
 * @throws {Error} git exited non-zero; the message carries its stderr
 */
export function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw gitFailure(args, error);
  }
}

/**
 * git's trimmed stdout, or null when it exited 1: the "no" of `--verify` and `--is-ancestor`.
 *
 * @throws {Error} any other failure, so a repository git cannot read never passes for one without the object
 */
function gitOrNo(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) {
      return null;
    }

    throw gitFailure(args, error);
  }
}

/**
 * Holds the checkout to the commit whose build is published: the manifest and package.json are read at HEAD.
 *
 * @throws {Error} HEAD is another commit
 */
export function assertCheckoutAt(cwd: string, sourceSha: string): void {
  const head = git(cwd, "rev-parse", "HEAD");

  if (head !== sourceSha) {
    throw new Error(`the checkout is at ${head}, not the source commit ${sourceSha} whose build is published.`);
  }
}

/**
 * A commit's position on main.
 *
 * @throws {Error} the checkout is shallow: the count would stop at the boundary and sort below older commits' versions
 */
export function mainPosition(cwd: string, sourceSha: string): MainPosition {
  if (git(cwd, "rev-parse", "--is-shallow-repository") === "true") {
    throw new Error(
      "the pre-release version needs the full history (fetch-depth: 0) and this checkout is shallow: the count of commits under the source would stop at the shallow boundary.",
    );
  }

  const count = Number(git(cwd, "rev-list", "--count", "--first-parent", sourceSha));
  const committed = Number(git(cwd, "show", "-s", "--format=%ct", sourceSha));
  const date = new Date(committed * 1000).toISOString().slice(0, 10).replaceAll("-", "");

  return { count, date };
}

/** The checkout's commit graph. */
export function gitAncestry(cwd: string): Ancestry {
  return {
    resolve: (name) => gitOrNo(cwd, "rev-parse", "--verify", "--quiet", `${name}^{commit}`),
    isAncestor: (ancestor, descendant) => gitOrNo(cwd, "merge-base", "--is-ancestor", ancestor, descendant) !== null,
  };
}
