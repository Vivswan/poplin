// The files a guard of the tree reads. A guard that lists the disk reads a local note, a build folder, and a file another tool wrote a moment ago, so it fails in one checkout and passes in a fresh clone.

import { type DisposableTempDir, lstatSync, mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** What git is asked: the files it tracks and the new ones not yet added, less what `.gitignore` and the clone's own exclude file leave out. `-z` keeps a path with a space or a letter outside ASCII as it is written. */
const LISTING: readonly string[] = ["ls-files", "--cached", "--others", "--exclude-standard", "-z"];

/** The empty file, as git names it: an index entry can carry it with nothing stored. */
const EMPTY_BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

/** The listings already read, by root: git is asked once for each in a test process. */
const LISTED = new Map<string, readonly string[]>();

/** What a planted repository is told beyond the files it holds. */
interface Told {
  /** The lines of the clone's own `.git/info/exclude`. */
  readonly excluded?: readonly string[];

  /** The lines of `.gitignore`. */
  readonly ignored?: readonly string[];

  /** The files the index holds and the disk does not. */
  readonly deleted?: readonly string[];
}

/** What git prints for a command run in a folder. The `GIT_` variables a hook sets name the repository the commit is made in, so they are left out and git finds the folder's own. */
function git(root: string, args: readonly string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
  const command = `git ${args.join(" ")}`;
  let ran: ReturnType<typeof Bun.spawnSync>;

  try {
    ran = Bun.spawnSync(["git", "-C", root, ...args], { env, stdout: "pipe", stderr: "pipe" });
  } catch (cause) {
    throw new Error(`The guards of the tree read the files git lists, and git did not start for ${root}.`, { cause });
  }

  if (ran.exitCode !== 0) throw new Error(`The guards of the tree read the files git lists, and \`${command}\` failed in ${root}: ${ran.stderr?.toString().trim()}`);

  return ran.stdout?.toString() ?? "";
}

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** Whether a path is a file on disk now. One that is gone, and one under what was a folder and is a file now, is none. */
function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** A throwaway git repository outside this one, holding the given files as new ones, with what `told` leaves out of its listing and keeps in its index; it is removed when the caller's scope ends. */
export function plantedRepository(files: Readonly<Record<string, string>>, told: Told = {}): DisposableTempDir {
  const tree = mkdtempDisposableSync(join(tmpdir(), "planted-"));
  const { excluded = [], ignored = [], deleted = [] } = told;

  try {
    git(tree.path, ["init", "--quiet", "--template=", "--object-format=sha1"]);
    write(tree.path, ".git/info/exclude", excluded.join("\n"));
    if (ignored.length > 0) write(tree.path, ".gitignore", ignored.join("\n"));

    for (const [path, text] of Object.entries(files)) write(tree.path, path, text);
    for (const path of deleted) git(tree.path, ["update-index", "--add", "--cacheinfo", `100644,${EMPTY_BLOB},${path}`]);
  } catch (cause) {
    tree.remove();
    throw cause;
  }

  return tree;
}

/** The files of the repository at `root`, sorted, as paths from it with forward slashes on every system. A file the index holds and the disk does not is left out, and so is a link. Throws when git does not run there or lists no file. */
export function repositoryFiles(root: string): readonly string[] {
  const known = LISTED.get(root);
  if (known !== undefined) return known;

  const listed = new Set(git(root, LISTING).split("\0"));
  const files = [...listed].filter((path) => isFile(join(root, path))).sort();
  if (files.length === 0) throw new Error(`git lists no file in ${root}: a guard that read nothing would pass.`);

  LISTED.set(root, files);

  return files;
}
