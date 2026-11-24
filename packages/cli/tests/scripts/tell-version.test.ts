// A version told to the files a release bumps, in scratch repositories a test fills.
// Without it the script can leave a listed file at the version it had: the `test / next version` job then passes a test that states that version, and only the pull request of a release fails it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { plantedRepository } from "../../../../tests/support/repository-files";
import { tellVersion } from "../../scripts/tell-version";

/** The file that lists what a release bumps. */
const CONFIG = "release-please-config.json";

/** The version every file holds before it is told one. */
const RELEASED = "0.1.2";

/** The version that is told. */
const NEXT = "0.2.0";

/** The files a release bumps, as the config lists them: a version at the top of a file, one inside a list, and one inside a longer text. */
const BUMPED = [
  { type: "json", path: "packages/cli/package.json", jsonpath: "$.version" },
  { type: "json", path: ".claude-plugin/marketplace.json", jsonpath: "$.plugins[0].version" },
  { type: "json", path: "skills/poplin-mcp/.claude-plugin/plugin.json", jsonpath: "$.version" },
  { type: "json", path: "docs/install.json", jsonpath: "$.command" },
] as const;

/** The entries no version is told to, each with the sentence that stops the script. Each is the first listed entry with the one thing changed that stops it. */
const REFUSED = [
  [
    "a file of another type",
    { ...BUMPED[0], type: "yaml" },
    `${CONFIG} lists {"type":"yaml","path":"${BUMPED[0].path}","jsonpath":"$.version"}, and a version is told to a file of type json alone.`,
  ],
  ["a path no version is at", { ...BUMPED[0], jsonpath: "$.plugins[0].version" }, `${CONFIG} lists $.plugins[0].version in ${BUMPED[0].path}, and no version is at that path.`],
  ["a file that is not there", { ...BUMPED[0], path: "gone.json" }, `${CONFIG} lists gone.json, and no such file is there.`],
] as const;

/** The files at one version. The package pins a dependency at the released version, which is no version of its own. */
function filesAt(version: string): Readonly<Record<string, unknown>> {
  return {
    [BUMPED[0].path]: { name: "poplin", version, devDependencies: { example: RELEASED } },
    [BUMPED[1].path]: { name: "poplin", plugins: [{ name: "poplin", version, source: "./skills" }] },
    [BUMPED[2].path]: { name: "poplin-mcp", version },
    [BUMPED[3].path]: { command: `npx poplin@${version} install` },
  };
}

/** What a scratch repository is planted with: a config that lists the given entries, and the files at the released version, each as the text of its JSON. */
function planted(entries: readonly object[]): Readonly<Record<string, string>> {
  const files = { [CONFIG]: { packages: { ".": { "extra-files": entries } } }, ...filesAt(RELEASED) };

  return Object.fromEntries(Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)]));
}

/** The text of each given file, as a scratch repository holds it now. */
function texts(root: string, paths: readonly string[]): Readonly<Record<string, string>> {
  return Object.fromEntries(paths.map((path) => [path, readFileSync(join(root, path), "utf8")]));
}

describe("the version a release writes", () => {
  test("reaches every file the config lists, at the path it names, and changes nothing else in a file: without this a manifest is tested at the version it had, or a dependency pinned at that version is bumped", () => {
    using tree = plantedRepository(planted(BUMPED));

    const told = tellVersion(tree.path, NEXT);
    const held = Object.entries(texts(tree.path, told)).map(([path, text]) => [path, JSON.parse(text)]);

    expect(Object.fromEntries(held)).toEqual(filesAt(NEXT));
  });

  test.each(REFUSED)("stops at %s, with one sentence that names it, and writes nothing: without this the job goes on with that file at the version it had", (_what, entry, sentence) => {
    const files = planted([entry]);
    using tree = plantedRepository(files);

    expect(() => tellVersion(tree.path, NEXT)).toThrow(new Error(sentence));
    expect(texts(tree.path, Object.keys(files))).toEqual(files);
  });
});
