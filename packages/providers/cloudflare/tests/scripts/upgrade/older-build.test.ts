// The older build an upgrade starts from is put in a folder and built by commands a test stands in for, and this checkout's version is told above it, with the later step among its steps.
// Without it a version an install would not take, or a folder left behind by a failed build, first shows in a run of the upgrade.

import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prepareBuilds, versionAbove } from "../../../scripts/upgrade/older-build";

/** The file of a tree that says its version. */
const VERSION_FILE = join("packages", "cli", "package.json");

/** The folder of the product's steps, from the root of a tree. */
const STEPS_FOLDER = join("packages", "core", "src", "migrations");

/** This repository's own steps. */
const OWN_STEPS = join(import.meta.dir, "..", "..", "..", "..", "..", "..", STEPS_FOLDER);

/** Write the file that says a tree's version, with a line after it that must stay. */
function tellVersion(tree: string, version: string): void {
  mkdirSync(join(tree, "packages", "cli"), { recursive: true });
  writeFileSync(join(tree, VERSION_FILE), `{\n  "name": "poplin",\n  "version": "${version}",\n  "type": "module"\n}\n`);
}

/** Make a tree a checkout: the file that says its version, and this repository's own steps. */
function checkout(tree: string, version: string): void {
  tellVersion(tree, version);
  cpSync(OWN_STEPS, join(tree, STEPS_FOLDER), { recursive: true });
}

describe("the older build of a live upgrade", () => {
  // Drift: an install takes a release above its own version alone, so a build published at the older build's version, or below it, is never taken.
  test.each([
    ["0.0.0", "0.0.0", "0.0.1"],
    ["0.1.0", "0.1.0", "0.1.1"],
    ["0.2.0", "0.1.9", "0.2.0"],
    ["0.1.0", "0.9.0", "0.9.1"],
    ["0.1.0-main.7", "0.1.0", "0.1.1"],
  ] as const)("a checkout that says %s over an older build that says %s is published as %s", (own, older, published) => {
    expect(versionAbove(own, older)).toBe(published);
  });

  test("an older build with a version no install updates from is refused", () => {
    expect(() => versionAbove("0.1.0", "0.1.0-main.7")).toThrow("no plain version");
  });

  // Drift: a version written by a rewrite of the whole file reorders or reformats a file the release tool also writes.
  test("the checkout is told the version above the older build's on that one line and given the later step, and the archive is not left in the tree", () => {
    using root = mkdtempDisposableSync(join(tmpdir(), "poplin-upgrade-root-"));
    using holder = mkdtempDisposableSync(join(tmpdir(), "poplin-upgrade-older-"));
    const folder = join(holder.path, "older");
    checkout(root.path, "0.0.0");
    const steps = readdirSync(OWN_STEPS).length;
    const run = (command: readonly string[]): void => {
      if (command[1] === "archive") writeFileSync(join(folder, "tree.tar"), "");

      if (command[0] === "tar") tellVersion(folder, "0.0.0");
    };

    expect(prepareBuilds(root.path, "a-commit", folder, run)).toMatchObject({ older: "0.0.0", own: "0.0.1", step: { description: "add the upgrade proof" } });
    expect([readFileSync(join(root.path, VERSION_FILE), "utf8"), existsSync(join(folder, "tree.tar"))]).toEqual([`{\n  "name": "poplin",\n  "version": "0.0.1",\n  "type": "module"\n}\n`, false]);
    expect(readdirSync(join(root.path, STEPS_FOLDER))).toHaveLength(steps + 1);
  });

  // Drift: a folder left by a build that failed is taken for a built tree by the step after it.
  test("a build that fails leaves no folder, and the checkout's version and steps as they were", () => {
    using root = mkdtempDisposableSync(join(tmpdir(), "poplin-upgrade-root-"));
    using holder = mkdtempDisposableSync(join(tmpdir(), "poplin-upgrade-older-"));
    const folder = join(holder.path, "older");
    checkout(root.path, "0.0.0");
    const run = (command: readonly string[]): void => {
      if (command[1] === "archive") writeFileSync(join(folder, "tree.tar"), "");

      if (command[1] === "install") throw new Error("the packages did not install");
    };

    expect(() => prepareBuilds(root.path, "a-commit", folder, run)).toThrow("the packages did not install");
    expect([existsSync(folder), readFileSync(join(root.path, VERSION_FILE), "utf8").includes('"version": "0.0.0"')]).toEqual([false, true]);
    expect(readdirSync(join(root.path, STEPS_FOLDER))).toEqual(readdirSync(OWN_STEPS));
  });
});
