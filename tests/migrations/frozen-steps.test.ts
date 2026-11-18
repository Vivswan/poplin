// Scope: a schema step a release shipped has run on real installs, so its file is frozen from that release on. A file is named for the release its steps migrate away from.
// With the last release R, every file the tag of R holds is as the tag holds it, and the one file that may be new or change is `R.ts`: a new step is written there.
// A released step edited in place leaves the installs of that release without the change: they hold the step as stamped and never run it again.
//
// A change that an old settings row needs, such as a new key, is a step in `packages/core/src/migrations/` that writes the value into the stored row.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, HERE, lastRelease } from "./support/trees";

/** The folder of the steps, from the root of a repository. */
const STEPS_FOLDER = "packages/core/src/migrations";

/** The file of a version's steps: the version alone. */
const STEP_FILE = /^\d+\.\d+\.\d+\.ts$/;

/** The last release this checkout descends from. */
const RELEASE = lastRelease(HERE.root);

/** What the guard holds in this checkout, as the test's name. */
const FROZEN = `every file of steps ${RELEASE} shipped is as it shipped it, and every newer step is in the file named for ${RELEASE}`;

/** Reads the imports of a step that load a module; an import of types alone loads none. */
const SCANNER = new Bun.Transpiler({ loader: "ts" });

/** What makes a commit and a tag in a fixture repository read nothing from the machine: a fixed identity, no signing, and no hook. */
const SEALED: readonly string[] = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture@example.com",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "tag.gpgsign=false",
  "-c",
  "core.hooksPath=",
];

/** Every file of steps that takes a value from another file; one line each. */
function borrowing(root: string): string[] {
  const steps = readdirSync(join(root, STEPS_FOLDER)).filter((file) => STEP_FILE.test(file));

  return steps
    .filter((file) => SCANNER.scan(readFileSync(join(root, STEPS_FOLDER, file), "utf8")).imports.length > 0)
    .map((file) => `${file} imports a value: a step holds its statements itself`);
}

/** Every released file of steps that is no longer as its release shipped it, and every new file that is not the one named for that release; one line each. */
function thawed(root: string): string[] {
  const release = lastRelease(root);
  const released = git(root, ["ls-tree", "--name-only", release, `${STEPS_FOLDER}/`])
    .split("\n")
    .map((path) => path.slice(STEPS_FOLDER.length + 1));
  const open = `${release.slice(1)}.ts`;
  const frozen = released.filter((file) => STEP_FILE.test(file) && file !== open);
  const here = readdirSync(join(root, STEPS_FOLDER)).filter((file) => STEP_FILE.test(file));

  const changed = frozen.filter(
    (file) => !here.includes(file) || readFileSync(join(root, STEPS_FOLDER, file), "utf8") !== git(root, ["show", `${release}:${STEPS_FOLDER}/${file}`]),
  );
  const misplaced = here.filter((file) => !frozen.includes(file) && file !== open);

  return [
    ...changed.map((file) => `${file} is not as ${release} shipped it: a released step is never edited, and a change is a new step in ${open}`),
    ...misplaced.map((file) => `${file} is new and is not ${open}: a new step goes into the file named for the last release`),
  ].sort();
}

/** A repository outside this one with one step, commits the calls make, and the tags they set; it is removed when the caller's scope ends. */
function fixture(): { readonly root: string; readonly write: (file: string, text: string) => void; readonly commit: (tag?: string) => void } & Disposable {
  const folder = mkdtempDisposableSync(join(tmpdir(), "frozen-steps-"));
  const steps = join(folder.path, STEPS_FOLDER);
  git(folder.path, ["init", "--quiet", "--template=", "--initial-branch=main"]);
  mkdirSync(steps, { recursive: true });

  const commit = (tag?: string): void => {
    git(folder.path, ["add", "--all"]);
    git(folder.path, [...SEALED, "commit", "--quiet", "--allow-empty", "--message", "a commit"]);
    if (tag !== undefined) git(folder.path, [...SEALED, "tag", tag]);
  };

  return { root: folder.path, write: (file, text) => writeFileSync(join(steps, file), text), commit, [Symbol.dispose]: () => folder.remove() };
}

describe("released steps", () => {
  test(FROZEN, () => {
    expect(thawed(HERE.root)).toEqual([]);
  });

  test("every step holds its statements itself and imports types alone: without this a step changes with another file while its own file stays as its release shipped it", () => {
    using repository = fixture();
    repository.write(
      "0.0.0.ts",
      'import type { VersionSteps } from "./migrate";\nimport{TABLES}from "./tables";\nexport const ONE: VersionSteps = { tables: TABLES };\n',
    );
    repository.write("0.1.0.ts", 'import { type VersionSteps } from "./migrate";\nexport const TWO: VersionSteps = {};\n');

    expect([borrowing(HERE.root), borrowing(repository.root)]).toEqual([[], ["0.0.0.ts imports a value: a step holds its statements itself"]]);
  });

  test("the last release is the highest version among the tags a checkout descends from, by version and not by text; a checkout with none is told to fetch them: without this 0.9.0 outranks 0.10.0, and a clone without tags passes", () => {
    using repository = fixture();
    repository.write("0.0.0.ts", "one");

    repository.commit();
    expect(() => lastRelease(repository.root)).toThrow(`${repository.root} holds no release tag among its ancestors: fetch the tags from poplin's repository (\`git fetch --tags <repository>\`)`);
    repository.commit("v0.9.0");
    repository.commit("v0.10.0");
    git(repository.root, [...SEALED, "tag", "scratch"]);
    git(repository.root, [...SEALED, "tag", "v0.11.0-rc.1"]);
    git(repository.root, ["checkout", "--quiet", "-b", "side"]);
    repository.commit("v9.0.0");
    git(repository.root, ["checkout", "--quiet", "main"]);

    expect(lastRelease(repository.root)).toBe("v0.10.0");
  });

  test("a released file of steps that is edited or removed, and a new file that is not the one named for the last release, are named; a step written into that one file is not", () => {
    using repository = fixture();
    repository.write("0.9.0.ts", "one");
    repository.write("migrate.ts", "the runner");
    repository.commit("v1.0.0");
    repository.write("migrate.ts", "the runner, changed");
    repository.write("1.0.0.ts", "two");
    const made = thawed(repository.root);
    repository.write("1.0.0.ts", "two, and three");
    const appended = thawed(repository.root);

    repository.write("0.9.0.ts", "one, edited");
    repository.write("0.5.0.ts", "a step under a release that is over");
    repository.write("1.1.0.ts", "a step under a release that is not cut");
    const edited = thawed(repository.root);
    rmSync(join(repository.root, STEPS_FOLDER, "0.9.0.ts"));

    const named = [
      "0.5.0.ts is new and is not 1.0.0.ts: a new step goes into the file named for the last release",
      "0.9.0.ts is not as v1.0.0 shipped it: a released step is never edited, and a change is a new step in 1.0.0.ts",
      "1.1.0.ts is new and is not 1.0.0.ts: a new step goes into the file named for the last release",
    ];

    expect({ made, appended, edited, removed: thawed(repository.root) }).toEqual({ made: [], appended: [], edited: named, removed: named });
  });
});
