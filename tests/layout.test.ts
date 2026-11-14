import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const ENTRY_FIELDS = ["main", "module", "types", "bin", "exports"];

const BUILT_ENTRY = /^(?:\.\/)?dist\/(.+)\.mjs$/;

const UNMIRRORED: readonly (readonly [path: string, reason: string])[] = [
  ["packages/cloudflare/tests/login/login.test.ts", "drives the app package's login through the real Access check"],
];

const SUPPORT_FILE = /^(packages\/[^/]+)\/tests\/(.+)\/support\/[^/]+\.ts$/;

function scan(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: ROOT })].map((path) => path.replaceAll("\\", "/")).sort();
}

function packageOf(path: string): string {
  return path.split("/").slice(0, 2).join("/");
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
async function declaredEntries(packagePath: string): Promise<string[]> {
  const manifest: Record<string, unknown> = await Bun.file(join(ROOT, packagePath, "package.json")).json();
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

describe("package layout", () => {
  test("every source file sits in a concept folder or is a declared entry: without this src/ fills with files no concept owns", async () => {
    const loose = scan("packages/*/src/*.ts");
    const entries = (await Promise.all([...new Set(loose.map(packageOf))].map(declaredEntries))).flat();

    expect(loose.filter((path) => !entries.some((entry) => isEntry(path, entry)))).toEqual([]);
  });

  test("every test mirrors a source file of its package, tests/<path>/<name>.test.ts for src/<path>/<name>.ts: without this a moved or deleted module leaves its test behind", () => {
    const tests = scan("packages/*/tests/**/*.test.ts");
    const sources = new Set(scan("packages/*/src/**/*.ts"));

    expect(tests.length).toBeGreaterThan(0);
    expect(tests.filter((path) => !sources.has(path.replace("/tests/", "/src/").replace(/\.test\.ts$/, ".ts")))).toEqual(UNMIRRORED.map(([path]) => path));
  });

  test("every other file under tests/ sits in the support/ folder of a concept its package has: without this a shared fixture reads as a test with no source", () => {
    const shared = scan("packages/*/tests/**/*.ts").filter((path) => !path.endsWith(".test.ts"));
    const concepts = new Set(scan("packages/*/src/**/*.ts").map((path) => path.slice(0, path.lastIndexOf("/"))));

    expect(shared.filter((path) => !concepts.has(path.replace(SUPPORT_FILE, "$1/src/$2")))).toEqual([]);
  });
});
