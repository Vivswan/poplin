import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { plantedRepository, repositoryFiles } from "./support/repository-files";

const ROOT = join(import.meta.dir, "..");

const ENTRY_FIELDS = ["main", "module", "types", "bin", "exports"];

const BUILT_ENTRY = /^(?:\.\/)?dist\/(.+)\.mjs$/;

const UNMIRRORED: readonly (readonly [path: string, reason: string])[] = [
  ["packages/providers/cloudflare/tests/worker/request-budget.test.ts", "holds every request the Worker answers to a budget of database queries and storage calls"],
];

const PACKAGES = "packages/{*,providers/*}";

const PACKAGE = /^packages\/(?:providers\/[^/]+|[^/]+)/;

const SUPPORT_FILE = /^(packages\/(?:providers\/[^/]+|[^/]+))\/tests\/(.+)\/support\/[^/]+\.ts$/;

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

/** The tests that mirror no source file of their package. */
function unmirroredTests(root: string): string[] {
  const sources = new Set(scan(root, "src/**/*.ts"));

  return scan(root, "tests/**/*.test.ts").filter((path) => !sources.has(path.replace("/tests/", "/src/").replace(/\.test\.ts$/, ".ts")));
}

/** The files under tests/ that are no test and sit in no `support/` folder of a concept their package has. */
function strayShared(root: string): string[] {
  const shared = scan(root, "tests/**/*.ts").filter((path) => !path.endsWith(".test.ts"));
  const concepts = new Set(scan(root, "src/**/*.ts").map((path) => path.slice(0, path.lastIndexOf("/"))));

  return shared.filter((path) => !concepts.has(path.replace(SUPPORT_FILE, "$1/src/$2")));
}

describe("package layout", () => {
  test("every source file sits in a concept folder or is a declared entry: without this src/ fills with files no concept owns", async () => {
    expect(scan(ROOT, "src/*.ts").length).toBeGreaterThan(0);
    expect(await looseSources(ROOT)).toEqual([]);
  });

  test("every test mirrors a source file of its package, tests/<path>/<name>.test.ts for src/<path>/<name>.ts: without this a moved or deleted module leaves its test behind", () => {
    expect(scan(ROOT, "tests/**/*.test.ts").length).toBeGreaterThan(0);
    expect(unmirroredTests(ROOT)).toEqual(UNMIRRORED.map(([path]) => path));
  });

  test("every other file under tests/ sits in the support/ folder of a concept its package has: without this a shared fixture reads as a test with no source", () => {
    expect(scan(ROOT, "tests/**/support/*.ts").length).toBeGreaterThan(0);
    expect(strayShared(ROOT)).toEqual([]);
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
        "packages/providers/example/package.json": "{}",
        "packages/providers/example/src/loose.ts": "",
        "packages/providers/example/src/sites/site.ts": "",
        "packages/providers/example/tests/sites/gone.test.ts": "",
        "packages/providers/example/tests/gone/support/fixture.ts": "",
      },
      { excluded: ["scratch.ts", "scratch.test.ts"], ignored: ["built/"] },
    );

    expect(await looseSources(tree.path)).toEqual(["packages/demo/src/loose.ts", "packages/providers/example/src/loose.ts"]);
    expect(unmirroredTests(tree.path)).toEqual(["packages/demo/tests/sites/gone.test.ts", "packages/providers/example/tests/sites/gone.test.ts"]);
    expect(strayShared(tree.path)).toEqual(["packages/demo/tests/gone/support/fixture.ts", "packages/providers/example/tests/gone/support/fixture.ts"]);
  });
});
