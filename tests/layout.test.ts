import { describe, expect, test } from "bun:test";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..");

const ENTRY_FIELDS = ["main", "module", "types", "bin", "exports"];

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

/** The entry files a package's manifest names, as paths from the repository root; an `exports` target may hold one `*`. */
async function declaredEntries(packagePath: string): Promise<string[]> {
  const manifest: Record<string, unknown> = await Bun.file(join(ROOT, packagePath, "package.json")).json();
  const declared = ENTRY_FIELDS.flatMap((field) => stringLeaves(manifest[field]));

  return declared.map((entry) => join(packagePath, entry).replaceAll("\\", "/"));
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

  test("every test is named after a source module of its package: without this a renamed or deleted module leaves its test behind", () => {
    const tests = scan("packages/*/tests/**/*.test.ts");
    const modules = new Set(scan("packages/*/src/**/*.ts").map((path) => `${packageOf(path)}/${basename(path, ".ts")}`));

    expect(tests.length).toBeGreaterThan(0);
    expect(tests.filter((path) => !modules.has(`${packageOf(path)}/${basename(path, ".test.ts")}`))).toEqual([]);
  });
});
