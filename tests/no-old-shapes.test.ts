// Scope: this catches accidental handling of an old stored shape, and import leaks, in source under `packages/*/src` outside any `migrations/` folder; deliberate hiding is out of scope.

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The only files outside a `migrations/` folder that may import from one and may branch on a stored version. */
const DOORWAYS: readonly string[] = ["packages/core/src/database/open.ts"];

/** The files that count as source. */
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Rule (a): an import, a dynamic import, or a require whose path has a `migrations` segment. */
const MIGRATIONS_IMPORT = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(?:\/\*[^*]*\*\/\s*)?["'](?:[^"'\n]*\/)?migrations(?:\/[^"'\n]*)?["']/;

/** The names stored data is stamped under: `shape`, and the version words a stamp could be called instead. */
const STAMP = String.raw`\b(?:shape|(?:schema|data|record|storage|format|layout)_?[vV]ersion|(?:SCHEMA|DATA|RECORD|STORAGE|FORMAT|LAYOUT)_VERSION)\b`;

/** Rule (b): a stamp compared, switched on, tested in a condition, or probed with `in`. */
const STAMP_BRANCHES: readonly RegExp[] = [
  new RegExp(String.raw`${STAMP}["'\])!]*(?:\s+as\s+\w+\s*\)?)?\s*(?:[=!]==?|<=?|>=?)(?!=)`),
  new RegExp(String.raw`(?:[=!]==?|<=?|(?<!=)>=?)\s*[\w.?!\[\]"']*${STAMP}`),
  new RegExp(String.raw`\bswitch\s*\([^)]*${STAMP}`),
  new RegExp(String.raw`\b(?:if|while)\s*\((?:[^()]|\([^()]*\))*\(?[^()]*${STAMP}`),
  new RegExp(String.raw`${STAMP}["'\])]*\s*\?(?![.:])`),
  /["'](?:shape)["']\s+in\b/,
];

/** Rule (c): the words code grows when it keeps a retired shape alive. `compat` spares `compatible`; `v1` must stand as its own word or camel-case part. */
const RETIRED_WORDS: readonly RegExp[] = [/legacy/i, /deprecated/i, /backcompat/i, /backwards/i, /compat(?!ible)/i, /oldShape/i, /(?<![A-Za-z0-9])[vV]1(?![0-9])|(?<=[a-z])V1(?![0-9a-z])/, /fallback for old/i];

/** The throwaway trees made by this run, removed when it ends. */
const PLANTED_ROOTS: string[] = [];

function inMigrations(path: string): boolean {
  return path.split("/").includes("migrations");
}

/** Every source file under `packages/<package>/src`, as a path from the root with forward slashes. */
function sourceFiles(root: string): string[] {
  const packages = readdirSync(join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const files: string[] = [];

  for (const { name } of packages) {
    const source = join(root, "packages", name, "src");
    if (!existsSync(source)) continue;

    for (const entry of readdirSync(source, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) continue;

      files.push(join(entry.parentPath, entry.name).slice(root.length + 1).replaceAll("\\", "/"));
    }
  }

  return files.sort();
}

/** The rules a file is held to, by name. A doorway is bound by the word rule alone. */
function rulesFor(path: string): readonly (readonly [rule: string, patterns: readonly RegExp[]])[] {
  const words = ["retired-shape word", RETIRED_WORDS] as const;
  if (DOORWAYS.includes(path)) return [words];

  return [["imports migrations", [MIGRATIONS_IMPORT]], ["branches on a stamp", STAMP_BRANCHES], words];
}

/** Every place that breaks a rule, as `<rule>: <path>:<line>`, the line being where the match starts. A file is matched whole, so a statement broken over lines is seen. */
function violations(root: string): string[] {
  const found = new Set<string>();

  for (const path of sourceFiles(root).filter((file) => !inMigrations(file))) {
    const text = readFileSync(join(root, path), "utf8");

    for (const [rule, patterns] of rulesFor(path)) {
      for (const pattern of patterns) {
        for (const match of text.matchAll(new RegExp(pattern, `${pattern.flags}g`))) found.add(`${rule}: ${path}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
  }

  return [...found].sort();
}

/** A throwaway tree holding the given files, outside the repository. */
function planted(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "no-old-shapes-"));
  PLANTED_ROOTS.push(root);

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }

  return root;
}

afterAll(() => {
  for (const root of PLANTED_ROOTS) rmSync(root, { recursive: true, force: true });
});

describe("no old shapes outside migrations/", () => {
  test("drift: code that handles an old stored shape outside a migrations/ folder would outlive its step and never be deleted", () => {
    expect(violations(ROOT)).toEqual([]);
    expect(sourceFiles(ROOT)).toEqual(expect.arrayContaining([...DOORWAYS, "packages/core/src/migrations/registry.ts"]));
  });

  // Drift: a guard that matches nothing passes forever; each row is a violation planted in a throwaway tree that the guard must name.
  test.each([
    ["a static import of a step", 'import { REGISTRY } from "../migrations/registry";', "imports migrations"],
    ["an import of the folder itself", 'import "./migrations";', "imports migrations"],
    ["a dynamic import", 'const steps = await import("../../core/src/migrations/upgrade");', "imports migrations"],
    ["a dynamic import behind a comment", 'const steps = await import(/* only here */ "../migrations/upgrade");', "imports migrations"],
    ["a require", 'const steps = require("./migrations/registry");', "imports migrations"],
    ["a shape compared", "if (record.shape === 1) return rename(record);", "branches on a stamp"],
    ["a shape compared from the right", "const old = 2 > site.shape;", "branches on a stamp"],
    ["a shape read by key and compared", 'const old = fields["shape"] !== SITE_SHAPE;', "branches on a stamp"],
    ["a shape asserted present and compared", "const title = record.shape! === 1 ? record.text : record.title;", "branches on a stamp"],
    ["a shape cast and compared", "const title = (record.shape as number) === 1 ? record.text : record.title;", "branches on a stamp"],
    ["a shape switched on", "switch (record.shape) {", "branches on a stamp"],
    ["a shape tested in a condition", "while (isOld(record.shape)) record = step(record);", "branches on a stamp"],
    ["a shape in a ternary", "const title = record.shape ? record.title : record.text;", "branches on a stamp"],
    ["a shape probed with in", 'const stamped = "shape" in record;', "branches on a stamp"],
    ["a stored version number compared", "if (settings.schemaVersion < SCHEMA_VERSION) upgradeSettings();", "branches on a stamp"],
    ["the word legacy", "const legacyTitle = record.text;", "retired-shape word"],
    ["the word deprecated", "/** @deprecated use title */", "retired-shape word"],
    ["the word backcompat", "function backcompat(record: Site): Site {", "retired-shape word"],
    ["the word backwards", "// kept for backwards readers", "retired-shape word"],
    ["the word compat", "const compatSecret = record.token;", "retired-shape word"],
    ["the word oldShape", "function fromOldShape(record: unknown): Site {", "retired-shape word"],
    ["the word v1", "type SiteV1 = { text: string };", "retired-shape word"],
    ["the word v1, lowercase", "const v1 = parseFirst(record);", "retired-shape word"],
    ["a fallback for old records", "// fallback for old records without a title", "retired-shape word"],
    ["an import broken over lines", 'import { REGISTRY } from\n  "../migrations/registry";', "imports migrations"],
    ["a comparison broken over lines", "const title = record.shape\n  === 1 ? record.text : record.title;", "branches on a stamp"],
    ["a condition broken over lines", "if (\n  isOld(record.shape)\n) record = step(record);", "branches on a stamp"],
  ])("names %s", (_, line, rule) => {
    const root = planted({ "packages/demo/src/sites/planted.ts": `// A planted file.\n${line}\n` });

    expect(violations(root)).toEqual([`${rule}: packages/demo/src/sites/planted.ts:2`]);
  });

  test("drift: the rules bind everything but the places named; a guard that fired on those, or on current-shape code, would be switched off", () => {
    const oldShapeCode = 'import { REGISTRY } from "../migrations/registry";\nif (record.shape < 2) return fromLegacy(record);\n';
    const currentShapeCode = [
      "// An S3-compatible bucket.",
      "const SCHEMA = v.strictObject({ shape: v.literal(SITE_SHAPE), revision: REVISION });",
      "const stamped = { ...fields, shape: kind.shape, revision };",
      'type Draft<Rec> = Omit<Rec, "shape" | "revision">;',
      "interface Stamped { readonly shape?: number }",
      "const shapes = records.map((record) => record.shape);",
      "if (site.live_version === version.number) return version;",
      "const reshaped = version > 1;",
    ].join("\n");
    const root = planted({
      "packages/demo/src/migrations/0001-rename-text.ts": oldShapeCode,
      "packages/demo/src/sites/migrations/helper.ts": oldShapeCode,
      "packages/core/src/database/open.ts": oldShapeCode,
      "packages/demo/src/sites/current.ts": currentShapeCode,
      "packages/demo/tests/planted.test.ts": oldShapeCode,
      "packages/demo/README.md": oldShapeCode,
    });

    expect(violations(root)).toEqual(["retired-shape word: packages/core/src/database/open.ts:2"]);
  });
});
