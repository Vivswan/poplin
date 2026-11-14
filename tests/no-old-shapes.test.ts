// Scope: this catches accidental handling of an old stored shape, and import leaks, in source under `packages/*/src` outside any `migrations/` folder, and a retired name written anywhere in the repository; deliberate hiding is out of scope.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The only files outside a `migrations/` folder that may import from one and may branch on a stored version. */
const DOORWAYS: readonly string[] = ["packages/core/src/database/open.ts"];

/** The files that count as source. */
const SOURCE_FILES = new Bun.Glob("packages/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}");

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

/** The files a retired name is looked for in: source, tests, the skill, the docs, the module, and configuration. */
const TEXT_FILES = new Bun.Glob("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,jsonc,md,tf,hcl,yml,yaml,astro,toml}");

/** What is not read of them: what is installed or built, a folder whose name starts with a dot but for `.github`, and a `.d.ts` file, which is written from the configuration that is read itself. */
const UNREAD = /(?:^|\/)(?:node_modules|dist|\.(?!github\/)[^/]+)\/|\.d\.ts$/;

/** The setting `gallery` as it was written: given a value, declared to the module, or named to `poplin config`. The word alone is still the name the install keeps back. */
const GALLERY_SETTING = /\bgallery["']?\s*[:=]\s*(?:["'](?:on|off)["']|true\b|false\b|onOff\(|v\.boolean\(|var\.)|variable "gallery"|\bvar\.gallery\b|\bconfig gallery\b/;

/** Rule (d): the names of what the install no longer has. One written anywhere would describe, test, or configure something that is gone. */
const RETIRED_NAMES: readonly RegExp[] = [
  /\b(?:parse|apply|strip)Suffix\b|\bDEFAULT_SUFFIX\b/,
  /admin_hostname/,
  /\bzone_bots\b/,
  /\bZONE_SETTINGS\b/,
  /signed-everyone-out/,
  /\bprivate_sites\b/,
  GALLERY_SETTING,
  /\bcache_(?:html|files)\b/,
];

/** The places a retired name is rightly written, each with the one name it may hold: this guard holds them all. */
const NAMED_ON_PURPOSE: readonly { readonly path: string; readonly name?: RegExp }[] = [
  { path: "tests/no-old-shapes.test.ts" },
  // The test that the binding refuses the old key.
  { path: "packages/cloudflare/tests/zone/zone-binding.test.ts", name: /admin_hostname/ },
  // A run named after the admin hostname, which is no setting.
  { path: "packages/cloudflare/tofu/tests/zone.tftest.hcl", name: /zone_record_under_the_admin_hostname/ },
  // The preview's page of its own samples, which it calls its gallery and switches by an option of that name.
  { path: "tests/preview.test.ts", name: /gallery: false/ },
];

/** The throwaway trees made by this run, removed when it ends. */
const PLANTED_ROOTS: string[] = [];

function inMigrations(path: string): boolean {
  return path.split("/").includes("migrations");
}

/** Every source file under `packages/<package>/src`, as a path from the root with forward slashes. */
function sourceFiles(root: string): string[] {
  return [...SOURCE_FILES.scanSync({ cwd: root })].map((path) => path.replaceAll("\\", "/")).sort();
}

/** Every text file of the repository that is read, as a path from the root with forward slashes. */
function textFiles(root: string): string[] {
  const paths = [...TEXT_FILES.scanSync({ cwd: root, dot: true })].map((path) => path.replaceAll("\\", "/"));

  return paths.filter((path) => !UNREAD.test(path)).sort();
}

/** Whether a retired name found in a file is one the file is listed to hold. A listed name must cover the whole find, so a longer old word beside it is still named. */
function isNamedOnPurpose(path: string, line: string, found: string): boolean {
  return NAMED_ON_PURPOSE.some((place) => place.path === path && (place.name === undefined || (place.name.exec(line)?.[0].includes(found) ?? false)));
}

/** Every retired name written outside a `migrations/` folder, as `retired name: <path>:<line>`. */
function retiredNames(root: string): string[] {
  const found: string[] = [];

  for (const path of textFiles(root).filter((file) => !inMigrations(file))) {
    const lines = readFileSync(join(root, path), "utf8").split("\n");

    for (const [at, line] of lines.entries()) {
      const names = RETIRED_NAMES.flatMap((pattern) => pattern.exec(line)?.[0] ?? []);
      if (names.some((name) => !isNamedOnPurpose(path, line, name))) found.push(`retired name: ${path}:${at + 1}`);
    }
  }

  return found;
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

  return [...found, ...retiredNames(root)].sort();
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
    ["a marker read from a setting", "const marker = parseSuffix(raw.suffix);", "retired name"],
    ["an admin hostname read from a binding", "const host = binding.admin_hostname;", "retired name"],
    ["the zone's bot switches under their old key", "const bots = settings.zone_bots;", "retired name"],
    ["the zone values under their old binding", "const zone = env.ZONE_SETTINGS;", "retired name"],
    ["the old audit action of a sign-out", 'log("signed-everyone-out");', "retired name"],
    ["the setting of an install with no domain", 'const kind = settings.private_sites === "folders";', "retired name"],
    ["the gallery's switch as a setting", "const VALUES = { gallery: v.boolean() };", "retired name"],
    ["the cache time of HTML as a setting", "const seconds = settings.cache_html.count;", "retired name"],
    ["the cache time of other files as a setting", 'const kept = settings.cache_files === "off";', "retired name"],
    ["an import broken over lines", 'import { REGISTRY } from\n  "../migrations/registry";', "imports migrations"],
    ["a comparison broken over lines", "const title = record.shape\n  === 1 ? record.text : record.title;", "branches on a stamp"],
    ["a condition broken over lines", "if (\n  isOld(record.shape)\n) record = step(record);", "branches on a stamp"],
  ])("names %s", (_, line, rule) => {
    const root = planted({ "packages/demo/src/sites/planted.ts": `// A planted file.\n${line}\n` });

    expect(violations(root)).toEqual([`${rule}: packages/demo/src/sites/planted.ts:2`]);
  });

  // Drift: a retired name lives on longest where no compiler reads it: a test that still passes, a page of the skill, a variable of the module.
  test.each([
    ["a test", "packages/demo/tests/planted.test.ts", 'expect(settings.private_sites).toBe("single-file");'],
    ["a page of the skill", "skills/demo/references/planted.md", "Run `poplin config gallery on` to list the public sites."],
    ["a page of the docs", "docs/planted.md", "| `zone_bots` | the zone's bot switches |"],
    ["a variable of the module", "packages/demo/tofu/variables.tf", 'variable "gallery" {'],
    ["a value of the module", "packages/demo/tofu/main.tf", '    gallery = var.gallery ? "on" : "off"'],
    ["the Worker's first settings", "packages/demo/wrangler.jsonc", '      "private_sites": "single-file",'],
  ])("names a retired name in %s", (_, path, line) => {
    const root = planted({ [path]: `A planted file.\n${line}\n` });

    expect(violations(root)).toEqual([`retired name: ${path}:2`]);
  });

  // Drift: an allow-list by file alone would let any old name back into a file that rightly holds one.
  test("a file listed for one retired name is still named for another, and the word gallery alone is no setting", () => {
    const root = planted({
      "packages/cloudflare/tests/zone/zone-binding.test.ts": 'const refused = { admin_hostname: "dashboard.example.com" };\nconst old = { zone_bots: "on" };\n',
      "packages/demo/src/sites/names.ts": 'const OWN_NAMES = new Set(["gallery"]);\nconst serving = { gallery: async () => new Response("the gallery") };\n',
    });

    expect(violations(root)).toEqual(["retired name: packages/cloudflare/tests/zone/zone-binding.test.ts:2"]);
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
