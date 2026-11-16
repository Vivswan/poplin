// Scope: this catches accidental handling of an old stored shape in source under `packages/*/src` outside any `migrations/` folder, and a retired name written anywhere in the repository; deliberate hiding is out of scope.
// An import of a `migrations/` folder is refused by the lint settings, which `bun run lint` applies to the tree; this file plants each such import. A path written as a template is refused as a template, and its fix is the text the import rule reads.

import { describe, expect, test } from "bun:test";
import { mkdtempDisposableSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { plantedLint } from "./support/planted-lint";
import { plantedRepository, repositoryFiles } from "./support/repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The only files outside a `migrations/` folder that may branch on a stored version; the lint settings name the same files as the only ones that may import from one. */
const DOORWAYS: readonly string[] = ["packages/core/src/database/open.ts"];

/** The files that count as source. */
const SOURCE_FILES = new Bun.Glob("packages/*/src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}");

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

/** Rule (c): the words code grows when it keeps a retired shape alive. `compat` spares `compatible` and `compatibility`, which a provider's own settings are named with; `v1` must stand as its own word or camel-case part. */
const RETIRED_WORDS: readonly RegExp[] = [/legacy/i, /deprecated/i, /backcompat/i, /backwards/i, /compat(?!ib)/i, /oldShape/i, /(?<![A-Za-z0-9])[vV]1(?![0-9])|(?<=[a-z])V1(?![0-9a-z])/, /fallback for old/i];

/** The files a retired name is looked for in: source, tests, the skill, the docs, and configuration. */
const TEXT_FILES = new Bun.Glob("**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs,json,jsonc,md,yml,yaml,astro,toml}");

/** What is not read of them: what is installed or built, a folder whose name starts with a dot but for `.github`, and a `.d.ts` file, which is written from the configuration that is read itself. */
const UNREAD = /(?:^|\/)(?:node_modules|dist|\.(?!github\/)[^/]+)\/|\.d\.ts$/;

/** The setting `gallery` as it was written: given a value, or named to `poplin config`. The word alone is the preview's page of its samples. */
const GALLERY_SETTING = /\bgallery["']?\s*[:=]\s*(?:["'](?:on|off)["']|true\b|false\b|onOff\(|v\.boolean\()|\bconfig gallery\b/;

/** The gallery's address as it was written: the kind an address resolved to, the handler serving took, the name kept back from sites, and its hostname. */
const GALLERY_ADDRESS = /\bkind(?::| ===) ["']gallery["']|\bgallery\??: (?:async )?\(|\bGALLERY_NAME\b|\[["']gallery["']\]|\bgallery-(?:page\b|poplin\b|<)/;

/** Rule (d): the names of what the install no longer has. One written anywhere would describe, test, or configure something that is gone. */
const RETIRED_NAMES: readonly RegExp[] = [
  /\b(?:parse|apply|strip)Suffix\b|\bDEFAULT_SUFFIX\b/,
  /admin_hostname/,
  /\bzone_bots\b/,
  /\bZONE_SETTINGS\b/,
  /signed-everyone-out/,
  /\bprivate_sites\b/,
  GALLERY_SETTING,
  GALLERY_ADDRESS,
  /\bcache_(?:html|files)\b/,
];

/** The places a retired name is rightly written, each with the one name it may hold: this guard holds them all. */
const NAMED_ON_PURPOSE: readonly { readonly path: string; readonly name?: RegExp }[] = [
  { path: "tests/no-old-shapes.test.ts" },
  // The test that the binding refuses the old key.
  { path: "packages/providers/cloudflare/tests/shared/install/kind/zone-binding.test.ts", name: /admin_hostname/ },
  // The preview's page of its own samples, which it calls its gallery and switches by an option of that name.
  { path: "tests/preview.test.ts", name: /gallery: false/ },
];

function inMigrations(path: string): boolean {
  return path.split("/").includes("migrations");
}

/** Every source file of the repository under `packages/<package>/src`, as a path from the root with forward slashes. */
function sourceFiles(root: string): string[] {
  return repositoryFiles(root).filter((path) => SOURCE_FILES.match(path));
}

/** Every text file of the repository that is read, as a path from the root with forward slashes. */
function textFiles(root: string): string[] {
  return repositoryFiles(root).filter((path) => TEXT_FILES.match(path) && !UNREAD.test(path));
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

  return [["branches on a stamp", STAMP_BRANCHES], words];
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

describe("no old shapes outside migrations/", () => {
  test("drift: code that handles an old stored shape outside a migrations/ folder would outlive its step and never be deleted", () => {
    expect(violations(ROOT)).toEqual([]);
    expect(sourceFiles(ROOT)).toEqual(expect.arrayContaining([...DOORWAYS, "packages/core/src/migrations/registry.ts"]));
    expect(textFiles(ROOT)).toEqual(expect.arrayContaining(["README.md", "tests/no-old-shapes.test.ts"]));
  });

  // Drift: a guard that matches nothing passes forever; each row is a violation planted in a throwaway tree that the guard must name.
  test.each([
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
    ["the word compat before a capital", "const compatMode = readMode(record);", "retired-shape word"],
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
    ["the gallery as what an address resolves to", 'if (label === own) return { kind: "gallery" };', "retired name"],
    ["the gallery as a handler of serving", "const serving = { gallery: async (request) => page(request) };", "retired name"],
    ["the gallery's name kept back from sites", 'const OWN_NAMES = new Set(["gallery"]);', "retired name"],
    ["the gallery's hostname", 'const host = "gallery-page.example.com";', "retired name"],
    ["the gallery's hostname in a layout's picture", "//   gallery-<public word>.<domain>          the gallery", "retired name"],
    ["the cache time of HTML as a setting", "const seconds = settings.cache_html.count;", "retired name"],
    ["the cache time of other files as a setting", 'const kept = settings.cache_files === "off";', "retired name"],
    ["a comparison broken over lines", "const title = record.shape\n  === 1 ? record.text : record.title;", "branches on a stamp"],
    ["a condition broken over lines", "if (\n  isOld(record.shape)\n) record = step(record);", "branches on a stamp"],
  ])("names %s", (_, line, rule) => {
    using tree = plantedRepository({ "packages/demo/src/sites/planted.ts": `// A planted file.\n${line}\n` });

    expect(violations(tree.path)).toEqual([`${rule}: packages/demo/src/sites/planted.ts:2`]);
  });

  // Drift: a guard that names a provider's own setting would keep the code that states it out of the source, where its tests are.
  test.each([
    ["a provider's date of compatibility", 'const stated = { compatibility_date: config.compatibility_date, compatibility_flags: config.compatibility_flags };'],
    ["the word compatible", "// The two runners are compatible: the same cases run in both."],
  ])("names nothing for %s", (_, line) => {
    using tree = plantedRepository({ "packages/demo/src/sites/planted.ts": `// A planted file.\n${line}\n` });

    expect(violations(tree.path)).toEqual([]);
  });

  test("drift: an import of a migrations folder from outside one keeps a step alive after its release; every package's source is refused it, and a comment, a migrations folder, the doorway, and a test are not", () => {
    const leaks: readonly (readonly [leak: string, line: string, rule: string, what: string, file: string])[] = [
      ["a static import of a step", 'import { REGISTRY } from "../migrations/registry";', "noRestrictedImports", "../migrations", "packages/app/src/sites/planted.ts"],
      ["an import of the folder itself", 'import "./migrations";', "noRestrictedImports", "./migrations", "packages/cli/src/commands/planted.ts"],
      ["a dynamic import", 'const steps = await import("../../core/src/migrations/upgrade");', "noRestrictedImports", "../../core", "packages/providers/cloudflare/src/shared/worker/planted.ts"],
      ["a dynamic import behind a comment", 'const steps = await import(/* only here */ "../migrations/upgrade");', "noRestrictedImports", "../migrations", "packages/core/src/sites/planted.ts"],
      ["an import in single quotes", "import { REGISTRY } from '../migrations/registry';", "noRestrictedImports", "../migrations", "packages/dashboard/src/pages/planted.tsx"],
      ["an import by the package's name", 'import { REGISTRY } from "@poplin/core/src/migrations/registry";', "noRestrictedImports", "@poplin/core", "packages/app/src/api/planted.ts"],
      ["an import from the demo", 'import { REGISTRY } from "../../../core/src/migrations/registry";', "noRestrictedImports", "../../../core", "packages/demo/src/preview/planted.ts"],
      ["an import broken over lines", 'import { REGISTRY } from\n  "../migrations/registry";', "noRestrictedImports", "../migrations", "packages/app/src/login/planted.ts"],
      ["a require", 'const steps = require("./migrations/registry");', "noCommonJs", "require", "packages/cli/src/files/planted.ts"],
      ["an import from a package the settings do not name", 'import { REGISTRY } from "../migrations/registry";', "noRestrictedImports", "../migrations", "packages/other/src/sites/planted.ts"],
    ];
    const allowed = 'import { REGISTRY } from "../migrations/registry";\n// import { upgrade } from "./migrations/upgrade";\n';
    const core = `${allowed}import { Hono } from "hono";\n`;
    const refused = plantedLint({
      ...Object.fromEntries(leaks.map(([, line, , , file]) => [file, `// A planted file.\n${line}\n`])),
      "packages/app/src/sites/commented.ts": '// import { REGISTRY } from "../migrations/registry";\nexport const steps = "./migrations";\n',
      "packages/app/src/sites/migrations/helper.ts": allowed,
      "packages/providers/cloudflare/src/shared/database/migrations/helper.ts": allowed,
      "packages/app/tests/sites/planted.test.ts": allowed,
      "packages/core/tests/migrations/planted.test.ts": allowed,
      "packages/core/src/migrations/0001-rename-text.ts": core,
      "packages/core/src/sites/migrations/helper.ts": core,
      "packages/core/src/database/open.ts": core,
    });

    expect(refused).toEqual(
      [
        ...leaks.map(([, line, rule, what, file]) => `${rule}: ${file}:${1 + line.slice(0, line.indexOf(what)).split("\n").length}`),
        "noRestrictedImports: packages/core/src/database/open.ts:3",
        "noRestrictedImports: packages/core/src/migrations/0001-rename-text.ts:3",
        "noRestrictedImports: packages/core/src/sites/migrations/helper.ts:3",
      ].sort(),
    );
  });

  // Drift: a retired name lives on longest where no compiler reads it: a test that still passes, a page of the skill, a page of the docs.
  test.each([
    ["a test", "packages/demo/tests/planted.test.ts", 'expect(settings.private_sites).toBe("single-file");'],
    ["a page of the skill", "skills/demo/references/planted.md", "Run `poplin config gallery on` to list the public sites."],
    ["a page of the docs", "docs/planted.md", "| `zone_bots` | the zone's bot switches |"],
    ["the Worker's first settings", "packages/demo/wrangler.jsonc", '      "private_sites": "single-file",'],
  ])("names a retired name in %s", (_, path, line) => {
    using tree = plantedRepository({ [path]: `A planted file.\n${line}\n` });

    expect(violations(tree.path)).toEqual([`retired name: ${path}:2`]);
  });

  // Drift: an allow-list by file alone would let any old name back into a file that rightly holds one.
  test("a file listed for one retired name is still named for another, and the word gallery alone is no setting", () => {
    using tree = plantedRepository({
      "packages/providers/cloudflare/tests/shared/install/kind/zone-binding.test.ts": 'const refused = { admin_hostname: "dashboard.example.com" };\nconst old = { zone_bots: "on" };\n',
      "packages/demo/src/sites/names.ts": 'const OWN_PATHS = ["/gallery"];\nconst host = { samples, gallery: flags.gallery };\n',
    });

    expect(violations(tree.path)).toEqual(["retired name: packages/providers/cloudflare/tests/shared/install/kind/zone-binding.test.ts:2"]);
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
    using tree = plantedRepository({
      "packages/demo/src/migrations/0001-rename-text.ts": oldShapeCode,
      "packages/demo/src/sites/migrations/helper.ts": oldShapeCode,
      "packages/core/src/database/open.ts": oldShapeCode,
      "packages/demo/src/sites/current.ts": currentShapeCode,
      "packages/demo/tests/planted.test.ts": oldShapeCode,
      "packages/demo/README.md": oldShapeCode,
    });

    expect(violations(tree.path)).toEqual(["retired-shape word: packages/core/src/database/open.ts:2"]);
  });

  // Drift: a checkout that held two local notes failed here on their old names, every run, while a fresh clone passed.
  test("a file git is told to leave out is not read: a local note and a build folder are no part of the repository, a new file not yet added is", () => {
    const old = "const legacyTitle = record.text;\nconst bots = settings.zone_bots;\n";
    using tree = plantedRepository(
      {
        "packages/demo/src/sites/added.ts": old,
        "packages/demo/src/sites/note.ts": old,
        "packages/demo/src/built/bundle.ts": old,
        "NOTES.md": old,
        "built/page.md": old,
      },
      { excluded: ["/NOTES.md", "note.ts"], ignored: ["built/"] },
    );

    expect(violations(tree.path)).toEqual([
      "retired name: packages/demo/src/sites/added.ts:2",
      "retired-shape word: packages/demo/src/sites/added.ts:1",
    ]);
  });
});

describe("the files a guard of the tree reads", () => {
  test("a file the index still holds and the disk does not is left out, one under a folder that is a file now too: without this a guard run between a delete and its commit stops on a file that is gone", () => {
    using tree = plantedRepository({ "kept.ts": "", "docs/new page.md": "" }, { deleted: ["gone.ts", "kept.ts/under.ts"] });

    expect(repositoryFiles(tree.path)).toEqual(["docs/new page.md", "kept.ts"]);
  });

  test("a folder that is no repository and a repository with no file are each refused in plain words: a listing that came back empty would read as a tree with nothing wrong in it", () => {
    using folder = mkdtempDisposableSync(join(tmpdir(), "no-repository-"));
    using empty = plantedRepository({});

    expect(() => repositoryFiles(folder.path)).toThrow(/`git ls-files .*` failed in /);
    expect(() => repositoryFiles(empty.path)).toThrow("git lists no file in");
  });
});
