import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { plantedRepository, repositoryFiles } from "./support/repository-files";

const ROOT = join(import.meta.dir, "..");

const ENTRY_FIELDS = ["main", "module", "types", "bin", "exports"];

const BUILT_ENTRY = /^(?:\.\/)?dist\/(.+)\.mjs$/;

const UNMIRRORED: readonly (readonly [path: string, reason: string])[] = [
  ["packages/providers/cloudflare/tests/shared/worker/request-budget.test.ts", "holds every request the Worker answers to a budget of database queries and storage calls"],
];

const PACKAGES = "packages/{*,providers/*}";

const PACKAGE = /^packages\/(?:providers\/[^/]+|[^/]+)/;

const SUPPORT_FILE = /^(packages\/(?:providers\/[^/]+|[^/]+))\/tests\/(.+)\/support\/[^/]+\.ts$/;

const PROVIDERS = "packages/providers/";

const PARTS: readonly string[] = ["shared", "with-domain", "without-domain"];

const PART = /^packages\/providers\/[^/]+\/src\/([^/]+)\//;

const CHOOSERS: readonly (readonly [path: string, reason: string])[] = [
  ["packages/providers/cloudflare/src/shared/install/kind/first-run.ts", "makes the plug of the kind a person chose when nothing is set yet"],
  ["packages/providers/cloudflare/src/shared/install/kind/zone-binding.ts", "reads the `ZONE` binding, which holds the values of one kind or of the other"],
  ["packages/providers/cloudflare/src/shared/worker/hosts.ts", "builds where the install answers from the kind its `ZONE` binding names"],
];

const CROSSING: readonly (readonly [importer: string, imported: string])[] = [
  ["packages/providers/cloudflare/src/shared/worker/sweep.ts", "packages/providers/cloudflare/src/with-domain/pieces/rules/rules-follow"],
  ["packages/providers/cloudflare/src/without-domain/address-layout.ts", "packages/providers/cloudflare/src/with-domain/layout"],
  ["packages/providers/cloudflare/src/without-domain/path-plug.ts", "packages/providers/cloudflare/src/with-domain/zone-plug"],
];

const SCANNER = new Bun.Transpiler({ loader: "ts" });

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
