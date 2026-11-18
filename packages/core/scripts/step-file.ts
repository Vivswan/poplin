// The one writer of a schema step: it adds a step to the file of a version in `src/migrations/`, and makes and lists that file where the version has none yet.
//
//   0.1.0.ts                                  the steps that take a database on from 0.1.0, in the order they run
//   export const V0_1_0: VersionSteps = {     the version, then each step by its name, which holds its statements itself
//   registry.ts                               lists every file, in ascending order of version

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { VersionSteps } from "../src/migrations/migrate";

/** The file that lists every file of steps, in their folder. */
const REGISTRY = "registry.ts";

/** A version a file of steps is named for: three numbers, with nothing after them. */
const VERSION = /^\d+\.\d+\.\d+$/;

/** How every file of steps ends: the end of its steps, then of its record. A step is added before it. */
const FILE_END = "  ],\n};\n";

/** The line of the registry that loads one file of steps; the version is its first group. */
const LOADED = /^import \{ V[0-9_]+ \} from "\.\/(\d+\.\d+\.\d+)";\n/gm;

/** The first line of the registry that loads something, once the files of steps are taken out: theirs go before it. */
const FIRST_IMPORT = /^import /m;

/** The list of the registry: what stands before its files, the files, and what ends it. A list that holds a comment is none a file is added to: a line comment would take the file in. */
const LIST = /(export const VERSIONS: readonly VersionSteps\[\] = \[)([^\]/]*?)(,?\s*\];)/g;

/** One step as a file of steps writes it. */
type Written = VersionSteps["steps"][number];

/** What a file of steps exports under: `V`, then its version with a line for each dot. */
function exportOf(version: string): string {
  return `V${version.replaceAll(".", "_")}`;
}

/** The lines of one step, as they stand among the steps of a file. */
function stepLines(step: Written, notes: readonly string[]): string {
  return [
    ...notes.map((note) => `    ${note}`),
    "    {",
    `      name: ${JSON.stringify(step.name)},`,
    `      description: ${JSON.stringify(step.description)},`,
    "      statements: [",
    ...step.statements.map((statement) => `        ${JSON.stringify(statement)},`),
    "      ],",
    "    },",
    "",
  ].join("\n");
}

/** The file of a version that has no step yet, up to where its first step goes. */
function fileStart(version: string): string {
  return [
    `// The steps that take a database on from ${version}.`,
    "",
    'import type { VersionSteps } from "./migrate";',
    "",
    `/** The steps that leave ${version}. */`,
    `export const ${exportOf(version)}: VersionSteps = {`,
    `  version: ${JSON.stringify(version)},`,
    "  steps: [",
    "",
  ].join("\n");
}

/**
 * List one more file of steps in a registry, among the others in ascending order of version.
 *
 * @param registry - the text of the registry
 * @throws {Error} the registry does not list its files on one line of the known form
 */
function listed(registry: string, version: string): string {
  const versions = [...registry.matchAll(LOADED)].map((line) => String(line[1]));
  const loads = registry.replace(LOADED, "");
  const [list, more] = [...loads.matchAll(LIST)];
  const files = String(list?.[2]).split(",").filter((file) => file.trim() !== "");

  // Every file the list names is one a line of the known form loads: a file loaded in another form would be dropped from the list below.
  const known = list !== undefined && more === undefined && FIRST_IMPORT.test(loads) && files.length === versions.length;
  if (!known) throw new Error(`${REGISTRY} does not list its files of steps in the form a file is added to`);

  const all = [...versions, version].sort(Bun.semver.order);
  const lines = all.map((one) => `import { ${exportOf(one)} } from "./${one}";\n`).join("");

  return loads.replace(FIRST_IMPORT, `${lines}import `).replace(LIST, (_all, before: string, _files: string, after: string) => `${before}${all.map(exportOf).join(", ")}${after}`);
}

/**
 * Name a step after what it changes.
 *
 * @returns the description in lower case, with a hyphen for whatever is no letter and no digit and none at either end
 */
export function stepName(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Add a step to the file of a version, after the steps it holds. A version with no file gets one, listed in the registry.
 *
 * @param folder - the folder of the steps
 * @param version - the release the step migrates away from, as a bare `X.Y.Z`
 * @param notes - comment lines for whoever reads the file, above the step
 * @returns the name of the file, in the folder
 * @throws {Error} the version is no plain one, its file holds a step of that name already or does not end as a file of steps does, or the registry is not in the form a file is added to
 */
export function addStep(folder: string, version: string, step: Written, notes: readonly string[] = []): string {
  if (!VERSION.test(version)) throw new Error(`${version} is no version a file of steps is named for`);

  const name = `${version}.ts`;
  const file = join(folder, name);
  const added = `${stepLines(step, notes)}${FILE_END}`;

  if (!existsSync(file)) {
    const registry = listed(readFileSync(join(folder, REGISTRY), "utf8"), version);
    writeFileSync(file, `${fileStart(version)}${added}`, { flag: "wx" });
    writeFileSync(join(folder, REGISTRY), registry);

    return name;
  }

  const text = readFileSync(file, "utf8");
  if (!text.endsWith(FILE_END)) throw new Error(`${name} does not end as a file of steps does, so no step is added to it`);
  if (text.includes(`      name: ${JSON.stringify(step.name)},\n`)) throw new Error(`${name} holds a step named ${step.name} already`);

  writeFileSync(file, `${text.slice(0, -FILE_END.length)}${added}`);

  return name;
}
