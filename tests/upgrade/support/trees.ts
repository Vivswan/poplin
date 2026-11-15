// A tree: poplin's code as one commit holds it, in a folder. The upgrade check runs the last release's code from one, beside the code of this checkout.

import { mkdtempDisposableSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..", "..", "..");

/** The tag of a release: `v` and a version with nothing after it. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;

/** The install of a tree's packages: the tree's own lockfile, and no script of a package, which this check never needs run. */
const INSTALL: readonly string[] = ["install", "--frozen-lockfile", "--ignore-scripts"];

/** Poplin's code in a folder. */
export interface Tree {
  /** The folder that holds the code, as an absolute path. */
  readonly root: string;

  /** What a finding calls the code: a release's tag, a commit, or this checkout. */
  readonly name: string;
}

/** The code of this checkout. */
export const HERE: Tree = { root: ROOT, name: "this code" };

/** Run one command and answer what it printed. The `GIT_` variables a hook sets name the repository a commit is made in, so they are left out. */
function run(command: readonly string[], cwd: string): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const ran = Bun.spawnSync([...command], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (ran.exitCode !== 0) throw new Error(`\`${command.join(" ")}\` failed in ${cwd}: ${ran.stderr.toString().trim()}`);

  return ran.stdout.toString();
}

/**
 * Ask git of a repository.
 *
 * @returns what git printed
 * @throws {Error} git failed, with what it said
 */
export function git(root: string, args: readonly string[]): string {
  return run(["git", ...args], root);
}

/**
 * Find the last release a checkout descends from: the highest `vX.Y.Z` tag among its ancestors.
 *
 * The tags are asked, never the release manifest: on the pull request of a release the manifest already names the version being cut, which has no tag yet.
 *
 * @returns the tag, or `undefined` when no release is among the ancestors
 * @throws {Error} the checkout is shallow: its tags and ancestors are not there to ask
 */
export function lastRelease(root: string): string | undefined {
  if (git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true") {
    throw new Error(
      `${root} is a shallow checkout, which holds no release tag to upgrade from: fetch the history (\`git fetch --unshallow --tags\`, or \`fetch-depth: 0\` in a workflow)`,
    );
  }

  const tags = git(root, ["tag", "--merged", "HEAD", "--list", "v*"]).split("\n");
  const [newest] = tags.filter((tag) => RELEASE_TAG.test(tag)).sort((one, other) => Bun.semver.order(other.slice(1), one.slice(1)));

  return newest;
}

/** Remove a tree's folder in a process of its own: its tens of thousands of files, removed from here, hold up whatever else this process runs. */
async function removed(folder: string): Promise<void> {
  const removal = Bun.spawn(["rm", "-rf", folder], { stdio: ["ignore", "ignore", "inherit"] });
  if ((await removal.exited) !== 0) throw new Error(`${folder} was not removed`);
}

/**
 * Put the code of one commit in a folder of its own, with its packages installed from its own lockfile.
 *
 * @param ref - a tag or a commit of the repository at `root`
 * @returns the tree; disposing it removes the folder, which takes seconds for the packages it holds and holds up nothing meanwhile
 * @throws {Error} the commit is not in the repository, or its packages did not install
 */
export function checkOut(root: string, ref: string): Tree & AsyncDisposable {
  const folder = mkdtempDisposableSync(join(tmpdir(), "poplin-tree-"));

  try {
    const archive = join(folder.path, "tree.tar");
    git(root, ["archive", "--format=tar", `--output=${archive}`, ref]);
    run(["tar", "-xf", archive, "-C", folder.path], folder.path);
    rmSync(archive);
    run([process.execPath, ...INSTALL], folder.path);
  } catch (cause) {
    folder.remove();
    throw cause;
  }

  return { root: folder.path, name: ref, [Symbol.asyncDispose]: () => removed(folder.path) };
}

/**
 * Take one export of a module of a tree.
 *
 * @param path - the module, from the tree's root
 * @returns the export, typed as the caller says: the tree is another version's code, which no type of this checkout describes
 * @throws {Error} the tree has no such module or no such export, with what the check needs it for
 */
export async function part<Part>(tree: Tree, path: string, name: string): Promise<Part> {
  const module: Record<string, unknown> = await import(join(tree.root, path)).catch((cause: unknown) => {
    throw new Error(`${tree.name} has no ${path} that loads: the upgrade check reads that code through it`, { cause });
  });
  if (module[name] === undefined) throw new Error(`${tree.name} has no \`${name}\` in ${path}: the upgrade check reads that code through it`);

  return module[name] as Part;
}
