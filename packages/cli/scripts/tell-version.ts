// Tells this package's version to every file a release bumps: `bun run --cwd packages/cli tell-version`.
//
//   release-please-config.json   lists those files under `extra-files`, each with the path of its version
//   package.json                 holds the version that is told
//
// A release writes its version to each of them. The `test / next version` job runs this ahead of one, so its tests read the files as a release leaves them.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { JSONPath } from "jsonpath-plus";

/** The root of the repository, which the config counts its paths from. */
const ROOT = join(import.meta.dir, "..", "..", "..");

/** The manifest of this package. */
const PACKAGE = join(import.meta.dir, "..", "package.json");

/** The file that lists what a release bumps, in the root. */
const CONFIG = "release-please-config.json";

/** The one type of file a version is told to here. release-please reads each other type its own way. */
const TOLD_TYPE = "json";

/** A version inside a text, as release-please finds the one it replaces. */
const VERSION = /\d+\.\d+\.\d+(?:-[\w.]+)?(?:\+[-\w.]+)?/;

/** A file a release bumps, as an entry of `extra-files` names it. */
interface Bumped {
  /** How release-please reads the file. */
  readonly type: string;

  /** The file, as a path from the root. */
  readonly path: string;

  /** Where the version stands in the file, as a JSONPath. */
  readonly jsonpath: string;
}

/** The part of the config that is read: the files of the one package a release cuts, the root. */
interface Config {
  readonly packages: { readonly ".": { readonly "extra-files": readonly Bumped[] } };
}

/**
 * Write a version over the one in each text a JSONPath names, in a parsed file.
 *
 * @returns how many texts were told. A match that is no text, or a text with no version in it, is left alone, as a release leaves it
 */
function tellMatches(json: unknown, jsonpath: string, version: string): number {
  let told = 0;

  JSONPath({
    path: jsonpath,
    json,
    resultType: "all",
    callback: (_match, _kind, { value, parent, parentProperty }) => {
      if (typeof value !== "string" || !VERSION.test(value)) return;

      // A file that is one text alone has no parent to write the version in.
      if (typeof parent !== "object" || parent === null || parentProperty === null) return;

      Reflect.set(parent, parentProperty, value.replace(VERSION, version));
      told += 1;
    },
  });

  return told;
}

/**
 * Tell a version to every file a release bumps.
 *
 * @param root - the folder that holds the config, which the paths of its files are counted from
 * @returns the files told, as the config names them
 * @throws {Error} an entry is of another type than json, names a file that is not there, or names a path with no version at it
 */
export function tellVersion(root: string, version: string): readonly string[] {
  const config: Config = JSON.parse(readFileSync(join(root, CONFIG), "utf8"));
  const bumped = config.packages["."]["extra-files"];

  for (const entry of bumped) {
    const file = join(root, entry.path);

    if (entry.type !== TOLD_TYPE) throw new Error(`${CONFIG} lists ${JSON.stringify(entry)}, and a version is told to a file of type ${TOLD_TYPE} alone.`);

    if (!existsSync(file)) throw new Error(`${CONFIG} lists ${entry.path}, and no such file is there.`);

    const json: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (tellMatches(json, entry.jsonpath, version) === 0) throw new Error(`${CONFIG} lists ${entry.jsonpath} in ${entry.path}, and no version is at that path.`);

    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  }

  return bumped.map((entry) => entry.path);
}

if (import.meta.main) {
  const { version }: { readonly version: string } = JSON.parse(readFileSync(PACKAGE, "utf8"));

  for (const path of tellVersion(ROOT, version)) console.log(`${path} is told ${version}`);
}
