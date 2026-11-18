import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { plantedRepository, repositoryFiles } from "./support/repository-files";

const ROOT = join(import.meta.dir, "..");

const ENTRY_FIELDS = ["main", "module", "types", "bin", "exports"];

const BUILT_ENTRY = /^(?:\.\/)?dist\/(.+)\.mjs$/;

const UNMIRRORED: readonly (readonly [path: string, reason: string])[] = [
  ["packages/providers/cloudflare/tests/live/self.test.ts", "runs every live check against an install in memory"],
  ["packages/providers/cloudflare/tests/live/workflow.test.ts", "holds the Live Checks workflow to the pushes that start it and the steps it runs"],
  ["packages/providers/cloudflare/tests/shared/worker/request-budget.test.ts", "holds every request the Worker answers to a budget of database queries and storage calls"],
];

const PACKAGES = "packages/{*,providers/*}";

const PACKAGE = /^packages\/(?:providers\/[^/]+|[^/]+)/;

const SUPPORT_FILE = /^(packages\/(?:providers\/[^/]+|[^/]+))\/tests\/(.+)\/support\/[^/]+\.ts$/;

const PROVIDERS = "packages/providers/";

const PARTS: readonly string[] = ["shared", "with-domain", "without-domain"];

const PART = /^packages\/providers\/[^/]+\/src\/([^/]+)\//;

const CHOOSERS: readonly (readonly [path: string, reason: string])[] = [
  ["packages/providers/cloudflare/src/shared/install/first/installer.ts", "makes a new install of the kind a person chose, with that kind's plug"],
  ["packages/providers/cloudflare/src/shared/install/kind/zone-binding.ts", "reads the `ZONE` binding, which holds the values of one kind or of the other"],
  ["packages/providers/cloudflare/src/shared/install/upkeep/remove/remove.ts", "removes an install of either kind, with that kind's own removals"],
  ["packages/providers/cloudflare/src/shared/install/upkeep/repair/repair.ts", "mends an install of the kind its `ZONE` binding names, with that kind's plug"],
  ["packages/providers/cloudflare/src/shared/worker/hosts.ts", "builds where the install answers from the kind its `ZONE` binding names"],
];

const CROSSING: readonly (readonly [importer: string, imported: string])[] = [
  ["packages/providers/cloudflare/src/shared/worker/sweep.ts", "packages/providers/cloudflare/src/with-domain/pieces/rules/rules-follow"],
  ["packages/providers/cloudflare/src/without-domain/address-layout.ts", "packages/providers/cloudflare/src/with-domain/layout"],
  ["packages/providers/cloudflare/src/without-domain/path-plug.ts", "packages/providers/cloudflare/src/with-domain/zone-plug"],
];

const SCANNER = new Bun.Transpiler({ loader: "ts" });

const TEST_ENDING = /\.test\.tsx?$/;

const FOLDER_SIZE = 8;

const VERSION_STEPS = /(?:^|\/)migrations\/\d+\.\d+\.\d+\.ts$/;

const SIZED = /^(?:tests|packages\/(?:providers\/[^/]+|[^/]+)\/(?:src|tests|scripts|migrations))(?:\/|$)/;

const CEILINGS: readonly (readonly [folder: string, ceiling: number, holds: string])[] = [
  ["packages/app/src/console", 16, "the console: its entry, what every screen shares, and one folder for each screen"],
  ["packages/app/src/sites", 9, "serving a site: its addresses, its headers, and its files"],
  ["packages/app/tests/console", 12, "the tests of src/console/, file for file"],
  ["packages/cli/src", 10, "the CLI's entries and one folder for each concept"],
  ["packages/cli/src/commands", 9, "running a command, the table of every command, and one folder for each concept"],
  ["packages/core/src", 12, "the package's entry and one folder for each concept"],
  ["packages/core/src/actions", 9, "what every action shares, the start of an update, and one folder for each concept"],
  ["packages/core/src/actions/sites", 11, "the site actions but publish, and what they share"],
  ["packages/core/src/database", 15, "the database: its statements, one file for each table; the sums of page views are a table, so a file more"],
  ["packages/core/src/records", 20, "one file for each kind of record"],
  ["packages/core/tests", 9, "the tests of src/, file for file"],
  ["packages/core/tests/records", 10, "the tests of src/records/, file for file"],
  ["packages/dashboard/src", 17, "the client's entries and one folder for each screen"],
  ["packages/dashboard/src/access", 10, "the Access screen"],
  ["packages/dashboard/src/components/ui", 30, "the parts of the UI library, written by its tool at the path it names"],
  ["packages/dashboard/src/domain", 11, "the Domain screen"],
  ["packages/dashboard/src/lib", 11, "the client's helpers that no screen owns"],
  ["packages/dashboard/src/settings", 9, "the Settings screen"],
  ["packages/dashboard/src/shared", 15, "the parts every screen shares"],
  ["packages/dashboard/src/sites", 11, "the Sites screen"],
  ["packages/dashboard/src/usage", 9, "the Usage screen"],
  ["packages/dashboard/tests", 15, "the tests of src/, file for file"],
  ["packages/providers/cloudflare/scripts/live", 19, "the harness of the live checks, one file for each step of a run"],
  ["packages/providers/cloudflare/src/shared", 9, "one folder for each concept both kinds of install share"],
  ["packages/providers/cloudflare/src/shared/worker", 14, "the Worker: its entry and what it is made of"],
  ["packages/providers/cloudflare/tests/scripts/live", 11, "the tests of scripts/live/, file for file"],
  ["packages/providers/cloudflare/tests/shared", 9, "the tests of src/shared/, file for file"],
  ["packages/providers/cloudflare/tests/shared/worker", 10, "the tests of src/shared/worker/, file for file"],
  ["packages/providers/cloudflare/tests/shared/worker/support", 16, "the helpers of the Worker's tests, the rows of the request budget among them"],
  ["tests", 9, "the guards of the tree, one file for each, and the suites no package owns"],
  ["tests/fuzz", 20, "one file for each target"],
  ["tests/migrations/support", 9, "the helpers of the upgrade test"],
];

const MIRRORED: readonly string[] = ["/src/", "/"];

/** The files of the packages a pattern takes, as sorted paths from the root. The pattern is counted from a package's own folder: a folder of `packages`, or a provider's folder of `packages/providers`. */
function scan(root: string, pattern: string): string[] {
  const glob = new Bun.Glob(`${PACKAGES}/${pattern}`);

  return repositoryFiles(root).filter((path) => glob.match(path));
}

function packageOf(path: string): string {
  return PACKAGE.exec(path)?.[0] ?? "";
}

function stringLeaves(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (typeof value !== "object" || value === null) {
    return [];
  }

  return Object.values(value).flatMap(stringLeaves);
}

/** A published package's manifest names its build: `dist/<entry>.mjs` is built from `src/<entry>.ts`. */
function sourceOf(entry: string): string {
  return entry.replace(BUILT_ENTRY, "src/$1.ts");
}

/** The entry files a package's manifest names, as paths from the repository root; an `exports` target may hold one `*`. */
async function declaredEntries(root: string, packagePath: string): Promise<string[]> {
  const manifest: Record<string, unknown> = await Bun.file(join(root, packagePath, "package.json")).json();
  const declared = ENTRY_FIELDS.flatMap((field) => stringLeaves(manifest[field]));

  return declared.map((entry) => join(packagePath, sourceOf(entry)).replaceAll("\\", "/"));
}

function isEntry(path: string, entry: string): boolean {
  const [head, tail] = entry.split("*");

  if (head === undefined || tail === undefined) {
    return path === entry;
  }

  return path.length >= head.length + tail.length && path.startsWith(head) && path.endsWith(tail);
}

/** The source files that sit in no concept folder and that no manifest declares as an entry. */
async function looseSources(root: string): Promise<string[]> {
  const loose = scan(root, "src/*.ts");
  const entries = (await Promise.all([...new Set(loose.map(packageOf))].map((packagePath) => declaredEntries(root, packagePath)))).flat();

  return loose.filter((path) => !entries.some((entry) => isEntry(path, entry)));
}

/** The tests that mirror no file of their package: `tests/<path>/<name>.test.ts` is for `src/<path>/<name>.ts`, or for `<path>/<name>.ts` in a folder of the package beside `src`, such as `scripts`. */
function unmirroredTests(root: string): string[] {
  const sources = new Set(scan(root, "**/*.{ts,tsx}"));
  const mirrored = (path: string): boolean => MIRRORED.some((folder) => [".ts", ".tsx"].some((ending) => sources.has(path.replace("/tests/", folder).replace(TEST_ENDING, ending))));

  return scan(root, "tests/**/*.test.{ts,tsx}").filter((path) => !mirrored(path));
}

/** The files under tests/ that are no test and sit in no `support/` folder of a concept their package has: a folder of `src`, or of a folder of the package beside it. */
function strayShared(root: string): string[] {
  const shared = scan(root, "tests/**/*.ts").filter((path) => !path.endsWith(".test.ts"));
  const sources = scan(root, "**/*.ts").filter((path) => !path.includes("/tests/"));
  const concepts = new Set(sources.map((path) => path.slice(0, path.lastIndexOf("/"))));

  return shared.filter((path) => !MIRRORED.some((folder) => concepts.has(path.replace(SUPPORT_FILE, `$1${folder}$2`))));
}

/** What breaks the parts of a provider's source, one line each: the shared part loads a kind's code, a kind loads the other's, a chooser loads no kind, or a source file sits in no part. An import of types alone loads nothing. */
function partCrossings(root: string, choosers: readonly string[]): string[] {
  const found: string[] = [];

  for (const path of scan(root, "src/**/*.ts").filter((file) => file.startsWith(PROVIDERS))) {
    const part = PART.exec(path)?.[1] ?? "";
    const loaded = SCANNER.scan(readFileSync(join(root, path), "utf8")).imports.filter((loads) => loads.path.startsWith("."));
    const targets = loaded.map((loads) => posix.join(posix.dirname(path), loads.path));
    const outside = targets.filter((target) => ![part, "shared"].includes(PART.exec(target)?.[1] ?? part));

    if (!PARTS.includes(part)) found.push(`${path} sits in no part`);
    if (choosers.includes(path) && outside.length === 0) found.push(`${path} is named a chooser and loads no kind`);
    if (!choosers.includes(path)) found.push(...outside.map((target) => `${path} loads ${target}`));
  }

  return found.sort();
}

/** What the size rule refuses, one line each: a folder of a package's `src`, `tests`, `scripts`, or `migrations`, or of the root's `tests`, over the size or over the ceiling of its row, and a row whose folder is at the size or under it. */
function oversized(root: string, ceilings: ReadonlyMap<string, number>): string[] {
  const held = new Map<string, Set<string>>();

  for (const path of repositoryFiles(root)) {
    const parts = path.split("/");

    // A file of schema steps named for its version, in a folder named `migrations`, is not counted: each release adds one.
    const depths = VERSION_STEPS.test(path) ? parts.length - 1 : parts.length;

    for (let depth = 1; depth < depths; depth += 1) {
      const folder = parts.slice(0, depth).join("/");
      if (SIZED.test(folder)) held.set(folder, (held.get(folder) ?? new Set<string>()).add(parts[depth] ?? ""));
    }
  }

  const over = [...held].filter(([folder, entries]) => entries.size > (ceilings.get(folder) ?? FOLDER_SIZE));
  const stale = [...ceilings.keys()].filter((folder) => (held.get(folder)?.size ?? 0) <= FOLDER_SIZE);

  return [
    ...over.map(([folder, entries]) => `${folder} holds ${entries.size}, over ${ceilings.get(folder) ?? FOLDER_SIZE}`),
    ...stale.map((folder) => `${folder} has a row and holds no more than ${FOLDER_SIZE}`),
  ].sort();
}

describe("package layout", () => {
  test("every source file sits in a concept folder or is a declared entry: without this src/ fills with files no concept owns", async () => {
    expect(scan(ROOT, "src/*.ts").length).toBeGreaterThan(0);
    expect(await looseSources(ROOT)).toEqual([]);
  });

  test("every test mirrors a file of its package, tests/<path>/<name>.test.ts for src/<path>/<name>.ts, or for <path>/<name>.ts in a folder beside src: without this a moved or deleted module leaves its test behind", () => {
    expect(scan(ROOT, "tests/**/*.test.ts").length).toBeGreaterThan(0);
    expect(scan(ROOT, "tests/**/*.test.tsx").length).toBeGreaterThan(0);
    expect(unmirroredTests(ROOT)).toEqual(UNMIRRORED.map(([path]) => path));
  });

  test("every other file under tests/ sits in the support/ folder of a concept its package has: without this a shared fixture reads as a test with no source", () => {
    expect(scan(ROOT, "tests/**/support/*.ts").length).toBeGreaterThan(0);
    expect(strayShared(ROOT)).toEqual([]);
  });

  test("the shared part of a provider loads no kind's code, and a kind not the other's: without this a change to one kind of install breaks the other, where the checks of the changed kind alone do not look", () => {
    expect(partCrossings(ROOT, CHOOSERS.map(([path]) => path))).toEqual(CROSSING.map(([importer, imported]) => `${importer} loads ${imported}`).sort());
  });

  test("drift: a parts rule that reads nothing passes forever; each wrong way out of a part is planted and named, beside the ways that are right", () => {
    using tree = plantedRepository({
      "packages/providers/example/src/shared/install/sync.ts": 'import { plug } from "../../with-domain/plug";\nexport const used = plug;\n',
      "packages/providers/example/src/shared/install/kind/pick.ts": 'import { plug } from "../../../with-domain/plug";\nexport const used = plug;\n',
      "packages/providers/example/src/shared/install/kind/idle.ts": 'import type { Plug } from "../../../with-domain/plug";\nexport type Used = Plug;\n',
      "packages/providers/example/src/with-domain/plug.ts": 'import { sync } from "../shared/install/sync";\nimport { rules } from "./pieces/rules";\nexport const plug = [sync, rules];\n',
      "packages/providers/example/src/without-domain/plug.ts": 'import { plug } from "../with-domain/plug";\nexport const used = plug;\n',
      "packages/providers/example/src/zone/loose.ts": "",
      "packages/demo/src/zone/loose.ts": 'import { plug } from "../with-domain/plug";\nexport const used = plug;\n',
    });
    const choosers = ["packages/providers/example/src/shared/install/kind/pick.ts", "packages/providers/example/src/shared/install/kind/idle.ts"];

    expect(partCrossings(tree.path, choosers)).toEqual([
      "packages/providers/example/src/shared/install/kind/idle.ts is named a chooser and loads no kind",
      "packages/providers/example/src/shared/install/sync.ts loads packages/providers/example/src/with-domain/plug",
      "packages/providers/example/src/without-domain/plug.ts loads packages/providers/example/src/with-domain/plug",
      "packages/providers/example/src/zone/loose.ts sits in no part",
    ]);
  });

  test("a folder holds no more than 8 files and folders, but for the rows: without this a folder grows a file at a time and no change is the one that splits it. A ceiling comes down with its folder and never goes up", () => {
    expect(oversized(ROOT, new Map(CEILINGS.map(([folder, ceiling]) => [folder, ceiling])))).toEqual([]);
  });

  test("drift: a size rule that counts nothing passes forever; a folder over the size, one over its ceiling, and a row for a folder that is small again are each planted and named", () => {
    const files = (folder: string, count: number): Record<string, string> => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${folder}/file-${index}.ts`, ""]));
    const nine = (folder: string): Record<string, string> => files(folder, 9);
    using tree = plantedRepository({
      ...files("packages/demo/src/migrations", 8),
      "packages/demo/src/migrations/0.1.0.ts": "",
      "packages/demo/src/migrations/0.10.0.ts": "",
      ...nine("packages/providers/example/src/migrations"),
      "packages/providers/example/src/migrations/1.0.0.ts": "",
      ...files("packages/demo/src/versions", 8),
      "packages/demo/src/versions/1.0.0.ts": "",
      ...nine("packages/demo/src/sites"),
      ...nine("packages/demo/tests/sites/support"),
      ...nine("packages/providers/example/scripts"),
      ...nine("tests/fuzz"),
      ...nine("website/src"),
      "packages/demo/src/small/one.ts": "",
    });
    const ceilings = new Map([
      ["packages/demo/tests/sites/support", 9],
      ["tests/fuzz", 8],
      ["packages/demo/src/small", 12],
    ]);

    // Drift: a version's file of steps is left out in a `migrations` folder alone, and every other file there still counts.
    expect(oversized(tree.path, ceilings)).toEqual([
      "packages/demo/src/sites holds 9, over 8",
      "packages/demo/src/small has a row and holds no more than 8",
      "packages/demo/src/versions holds 9, over 8",
      "packages/providers/example/scripts holds 9, over 8",
      "packages/providers/example/src/migrations holds 9, over 8",
      "tests/fuzz holds 9, over 8",
    ]);
  });

  // Drift: a guard that lists the disk reads what is no part of the repository, and fails in the one checkout that holds it.
  test("each rule names a new file not yet added, and none reads a file the repository is told to leave out or a build folder", async () => {
    using tree = plantedRepository(
      {
        "packages/demo/package.json": '{ "bin": "dist/bin.mjs" }',
        "packages/demo/src/bin.ts": "",
        "packages/demo/src/loose.ts": "",
        "packages/demo/src/scratch.ts": "",
        "packages/demo/src/sites/site.ts": "",
        "packages/demo/tests/sites/site.test.ts": "",
        "packages/demo/tests/sites/gone.test.ts": "",
        "packages/demo/tests/sites/scratch.test.ts": "",
        "packages/demo/tests/built/old.test.ts": "",
        "packages/demo/tests/gone/support/fixture.ts": "",
        "packages/demo/tests/gone/support/scratch.ts": "",
        "packages/demo/tests/built/support/fixture.ts": "",
        "packages/demo/src/pages/page.tsx": "",
        "packages/demo/src/pages/hook.ts": "",
        "packages/demo/tests/pages/page.test.tsx": "",
        "packages/demo/tests/pages/hook.test.tsx": "",
        "packages/demo/tests/pages/gone.test.tsx": "",
        "packages/demo/scripts/tool.ts": "",
        "packages/demo/tests/scripts/tool.test.ts": "",
        "packages/demo/tests/scripts/gone.test.ts": "",
        "packages/demo/tests/scripts/support/fixture.ts": "",
        "packages/providers/example/package.json": "{}",
        "packages/providers/example/src/loose.ts": "",
        "packages/providers/example/src/sites/site.ts": "",
        "packages/providers/example/tests/sites/gone.test.ts": "",
        "packages/providers/example/tests/gone/support/fixture.ts": "",
      },
      { excluded: ["scratch.ts", "scratch.test.ts"], ignored: ["built/"] },
    );

    expect(await looseSources(tree.path)).toEqual(["packages/demo/src/loose.ts", "packages/providers/example/src/loose.ts"]);
    expect(unmirroredTests(tree.path)).toEqual([
      "packages/demo/tests/pages/gone.test.tsx",
      "packages/demo/tests/scripts/gone.test.ts",
      "packages/demo/tests/sites/gone.test.ts",
      "packages/providers/example/tests/sites/gone.test.ts",
    ]);
    expect(strayShared(tree.path)).toEqual(["packages/demo/tests/gone/support/fixture.ts", "packages/providers/example/tests/gone/support/fixture.ts"]);
  });
});
