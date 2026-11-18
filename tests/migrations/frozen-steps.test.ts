// Scope: a schema step a release shipped has run on real installs, so its file is frozen from that release on, and a new step takes a number above every released one.
// A released step edited in place leaves the installs of that release without the change: they hold the step as stamped and never run it again.
//
// Before the first release no step is frozen. A change that an old settings row needs, such as a new key, is a step in `packages/core/src/migrations/` that writes the value into the stored row.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, HERE, lastRelease } from "./support/trees";

/** The folder of the steps, from the root of a repository. */
const STEPS_FOLDER = "packages/core/src/migrations";

/** The file of a step: its number, then what it does. */
const STEP_FILE = /^(\d{4})-[a-z0-9-]+\.ts$/;

/** The last release this checkout descends from; none before the first. */
const RELEASE = lastRelease(HERE.root);

/** What the guard holds in this checkout, as the test's name. */
const FROZEN =
  RELEASE === undefined
    ? "nothing is released yet, so no step is frozen"
    : `every step ${RELEASE} shipped is as it shipped it, and every newer step is numbered above them`;

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

function stepNumber(file: string): number {
  return Number(STEP_FILE.exec(file)?.[1]);
}

/** Every step that takes a value from another file; one line each. */
function borrowing(root: string): string[] {
  const steps = readdirSync(join(root, STEPS_FOLDER)).filter((file) => STEP_FILE.test(file));

  return steps
    .filter((file) => SCANNER.scan(readFileSync(join(root, STEPS_FOLDER, file), "utf8")).imports.length > 0)
    .map((file) => `${file} imports a value: a step holds its statements itself`);
}

/** Every released step that is no longer as its release shipped it, and every other step numbered at or below a released one; one line each, none before the first release. */
function thawed(root: string): string[] {
  const release = lastRelease(root);
  if (release === undefined) return [];

  const released = git(root, ["ls-tree", "--name-only", release, `${STEPS_FOLDER}/`])
    .split("\n")
    .map((path) => path.slice(STEPS_FOLDER.length + 1));
  const frozen = released.filter((file) => STEP_FILE.test(file));
  const here = readdirSync(join(root, STEPS_FOLDER)).filter((file) => STEP_FILE.test(file));
  const highest = Math.max(0, ...frozen.map(stepNumber));

  const changed = frozen.filter(
    (file) => !here.includes(file) || readFileSync(join(root, STEPS_FOLDER, file), "utf8") !== git(root, ["show", `${release}:${STEPS_FOLDER}/${file}`]),
  );
  const misnumbered = here.filter((file) => !frozen.includes(file) && stepNumber(file) <= highest);

  return [
    ...changed.map((file) => `${file} is not as ${release} shipped it: a released step is never edited, and a change is a new step`),
    ...misnumbered.map((file) => `${file} is new and numbered at or below a step ${release} shipped: a new step takes the next number`),
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
      "0001-create-schema.ts",
      'import type { Step } from "./migrate";\nimport{TABLES}from "./tables";\nexport const ONE: Step = { tables: TABLES };\n',
    );
    repository.write("0002-add-a-column.ts", 'import { type Step } from "./migrate";\nexport const TWO: Step = {};\n');

    expect([borrowing(HERE.root), borrowing(repository.root)]).toEqual([[], ["0001-create-schema.ts imports a value: a step holds its statements itself"]]);
  });

  test("the last release is the highest version among the tags a checkout descends from, by version and not by text: without this 0.9.0 outranks 0.10.0 and a tag of another branch counts", () => {
    using repository = fixture();
    repository.write("0001-create-schema.ts", "one");

    repository.commit();
    const unreleased = lastRelease(repository.root);
    repository.commit("v0.9.0");
    repository.commit("v0.10.0");
    git(repository.root, [...SEALED, "tag", "scratch"]);
    git(repository.root, [...SEALED, "tag", "v0.11.0-rc.1"]);
    git(repository.root, ["checkout", "--quiet", "-b", "side"]);
    repository.commit("v9.0.0");
    git(repository.root, ["checkout", "--quiet", "main"]);

    expect([unreleased, lastRelease(repository.root)]).toEqual([undefined, "v0.10.0"]);
  });

  test("a released step that is edited, removed, or joined by a new step under its number is named, and a new step above it is not", () => {
    using repository = fixture();
    repository.write("0001-create-schema.ts", "one");
    repository.write("migrate.ts", "the runner");
    repository.commit();
    const before = thawed(repository.root);
    repository.commit("v1.0.0");
    repository.write("migrate.ts", "the runner, changed");
    repository.write("0002-add-a-column.ts", "two");
    const appended = thawed(repository.root);

    repository.write("0001-create-schema.ts", "one, edited");
    repository.write("0001-another-first.ts", "a second first step");
    const edited = thawed(repository.root);
    rmSync(join(repository.root, STEPS_FOLDER, "0001-create-schema.ts"));

    expect({ before, appended, edited, removed: thawed(repository.root) }).toEqual({
      before: [],
      appended: [],
      edited: [
        "0001-another-first.ts is new and numbered at or below a step v1.0.0 shipped: a new step takes the next number",
        "0001-create-schema.ts is not as v1.0.0 shipped it: a released step is never edited, and a change is a new step",
      ],
      removed: [
        "0001-another-first.ts is new and numbered at or below a step v1.0.0 shipped: a new step takes the next number",
        "0001-create-schema.ts is not as v1.0.0 shipped it: a released step is never edited, and a change is a new step",
      ],
    });
  });
});
