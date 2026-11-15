// Scope: this catches a provider named in portable source or in its package and TypeScript settings, and one provider's code reaching another's. A name built at run time and a type that copies a binding's shape are out of scope.
//
// The lint settings hold the import, type, and global rules, and `bun run lint` applies them to the tree. This file plants a leak for each, and reads what no lint rule does:
//
//   words, binding types, headers, hosts, `.cf`     in the code of a source file, comments apart
//   a types reference                               the one import that is a comment
//   a manifest, a `tsconfig`                        a provider taken in with no import
//
// The provider's words are read in the code of a portable `src` folder by these rules:
//
//   cloudflare, wrangler, workers.dev   any case, anywhere in a name or a text
//   worker                              any case: a browser's own worker is an allowed row, by file
//   zone                                any case, but `timeZone` and "time zone"
//   R2, D1                              a whole word or a part of a name (`r2`, `openR2`, `d1Database`), never inside a longer run such as `r2d2`
//
// A JSX file is read as it is compiled, so a name only a type holds is unread there, and a find sits at the first line that writes it.
//
// Out of scope: what loads no module (a `declare module` block, a module a test replaces), and a path given to a loader that is no import (`import.meta.resolve`, a template).
// A provider's package named that way is still no dependency of a portable package: the unused-code check names it as unlisted, and the manifest may not list it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { SyntaxKind } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";

import { plantedLint } from "./support/planted-lint";
import { plantedRepository, repositoryFiles } from "./support/repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The folders that hold no provider: another provider is added without touching them. Every other folder of `packages` is one provider's own. */
const PORTABLE: readonly string[] = ["packages/core", "packages/app", "packages/cli", "packages/dashboard", "packages/demo"];

/** The part of a portable package whose code is read for the provider's words. */
const WORD_PLACE = /^packages\/[^/]+\/src\//;

/** The provider's own modules, as a manifest dependency or the name of a types reference. */
const PROVIDER_MODULE = /^(?:cloudflare(?:[:/].*)?|@cloudflare\/.*|wrangler(?:\/.*)?|miniflare(?:\/.*)?)$/;

/** The provider's names no lint rule reads: its families of binding types and its generated namespace, the members of its runtime, the `cf` object on a request, the headers and cookies only it sends, and its own hosts. */
const NAMES: readonly (readonly [rule: string, pattern: RegExp])[] = [
  ["provider type", /\b(?:R2[A-Z]\w*|D1[A-Z]\w*|KVNamespace\w*|DurableObject\w*)\b|\bCloudflare\.[A-Z]\w*/g],
  ["provider global", /\bcaches\.default\b|\.waitUntil(?=\s*\()|\bglobalThis\s*(?:\.|\[\s*["'`])\s*(?:HTMLRewriter|FixedLengthStream|WebSocketPair)\b/g],
  ["provider request property", /\.cf\b(?!\s*\()|\[["']cf["']\]|(?<![\w.$"'`-])cf(?=\s*[?:,}])/g],
  ["provider header", /(?<![\w-])cf-[a-z][a-z0-9-]*|(?<![\w-])cf_[a-z]\w*|\b__cf_bm\b|\b__cflb\b/gi],
  ["provider host", /(?:api\.cloudflare|cloudflareaccess|cloudflarestorage)\.com/g],
];

/** The provider's words, each with the name a finding carries; the table at the top of the file says what each takes. */
const WORDS: readonly (readonly [word: string, pattern: RegExp])[] = [
  ["cloudflare", /cloudflare/gi],
  ["workers.dev", /workers\.dev/gi],
  ["R2", /(?<![A-Za-z0-9])r2(?![a-z0-9])|(?<![A-Z0-9])R2(?![a-z0-9])/g],
  ["D1", /(?<![A-Za-z0-9])d1(?![a-z0-9])|(?<![A-Z0-9])D1(?![a-z0-9])/g],
  ["worker", /worker(?!s\.dev)s?/gi],
  ["wrangler", /wrangler/gi],
  ["zone", /(?<!time\s?)zone/gi],
];

/** The tokens a value ends with: a `/` after one divides, and any other `/` opens a regular expression. */
const VALUE_END: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.Identifier,
  SyntaxKind.NumericLiteral,
  SyntaxKind.BigIntLiteral,
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateTail,
  SyntaxKind.CloseParenToken,
  SyntaxKind.CloseBracketToken,
  SyntaxKind.CloseBraceToken,
  SyntaxKind.ThisKeyword,
  SyntaxKind.PlusPlusToken,
  SyntaxKind.MinusMinusToken,
]);

/** The findings that stay: the file, what is found in it, and why it may be there. A row that finds nothing fails. */
const ALLOWED: readonly (readonly [file: string, what: string, reason: string])[] = [
  ["packages/demo/src/browser/worker.ts", ".waitUntil", "the event of a browser's service worker has this method; no provider's context is in reach there"],
  ["packages/demo/src/browser/worker.ts", "worker", "a browser's service worker, which the demo runs in"],
  ["packages/demo/src/browser/kept-demo.ts", "worker", "a browser's service worker, which the demo runs in"],
  ["packages/demo/src/browser/free-headers.ts", "worker", "a browser's service worker, which the demo runs in"],
];

/** The files that are read as source. */
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The source files that hold JSX, by the loader that compiles each. */
const JSX_FILE = /\.([jt]sx)$/;

/** A folder of `packages`, at the start of the path of a file in it. */
const PACKAGE_FOLDER = /^packages\/[^/]+(?=\/)/;

/** The folders whose files are never read: installed and built code. */
const SKIPPED_FOLDERS: readonly string[] = ["node_modules", "dist"];

/** The TypeScript settings files, whose `types` load a module's globals with no import. */
const SETTINGS_FILE = /^tsconfig.*\.json$/;

/** A reference directive, the one import that is a comment; the first group is the path. */
const REFERENCE = /^\s*\/\/\/\s*<reference\s+(?:types|path)=["']([^"'\n]+)["']/gm;

/** The manifest fields that name what a package depends on. */
const DEPENDENCY_FIELDS: readonly string[] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** The places a planted leak is refused in: every portable package's source, tests, and scripts, the two the dashboard is built in among them. */
const PORTABLE_PLACES: readonly string[] = [
  "packages/core/src/storage/planted.ts",
  "packages/core/tests/planted.test.ts",
  "packages/app/src/api/planted.ts",
  "packages/app/src/console/planted.ts",
  "packages/app/tests/sites/planted.ts",
  "packages/cli/src/commands/planted.ts",
  "packages/cli/scripts/planted.mts",
  "packages/dashboard/src/pages/planted.tsx",
  "packages/dashboard/tests/planted.test.tsx",
  "packages/demo/src/preview/planted.ts",
  "packages/demo/scripts/planted.ts",
];

/** One repository as the guard reads it. */
interface Tree {
  /** The folder the paths are counted from. */
  readonly root: string;

  /** The workspace's packages: the name a manifest gives, to its folder from the root. */
  readonly packages: ReadonlyMap<string, string>;

  /** The folders of `packages` that are not portable, each one provider's own. */
  readonly providers: readonly string[];
}

function isUnder(path: string, place: string): boolean {
  return path === place || path.startsWith(`${place}/`);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Every file of one kind the repository holds under the places, as a path from the root with forward slashes. */
function filesUnder(root: string, places: readonly string[], kind: RegExp = SOURCE_FILE): string[] {
  const files = repositoryFiles(root).filter((path) => places.some((place) => isUnder(path, place)));

  return files.filter((path) => kind.test(posix.basename(path)) && !path.split("/").some((part) => SKIPPED_FOLDERS.includes(part)));
}

/** Read a repository's `packages` folder: which folders are a provider's, and what each manifest names its package. */
function readTree(root: string): Tree {
  const packages = new Map<string, string>();
  const files = repositoryFiles(root);
  const folders = [...new Set(files.flatMap((path) => PACKAGE_FOLDER.exec(path)?.[0] ?? []))];

  for (const folder of folders.filter((place) => files.includes(`${place}/package.json`))) {
    packages.set(JSON.parse(readFileSync(join(root, folder, "package.json"), "utf8")).name, folder);
  }

  return { root, packages, providers: folders.filter((folder) => !PORTABLE.includes(folder)).sort() };
}

/** The text of every token of a source file that is not a comment, as `[start, text]`. A template and a regular expression are each read whole, so a `//` inside one opens no comment. */
function codeTokens(text: string): [number, string][] {
  const scanner = createScanner(true, undefined, text);
  const tokens: [number, string][] = [];
  const braces: ("template" | "block")[] = [];
  let before = SyntaxKind.Unknown;

  for (let kind = scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = scanner.scan()) {
    if ((kind === SyntaxKind.SlashToken || kind === SyntaxKind.SlashEqualsToken) && !VALUE_END.has(before)) kind = scanner.reScanSlashToken();
    if (kind === SyntaxKind.CloseBraceToken && braces.pop() === "template") kind = scanner.reScanTemplateToken(false);

    if (kind === SyntaxKind.TemplateHead || kind === SyntaxKind.TemplateMiddle) braces.push("template");
    if (kind === SyntaxKind.OpenBraceToken) braces.push("block");

    // The scanner stays on text it cannot read, such as a template taken for code: an error names the place, where a loop would never end.
    const start = scanner.getTokenStart();
    if (scanner.getTokenEnd() === start) throw new Error(`no token at offset ${start}: ${JSON.stringify(text.slice(start, start + 40))}`);

    tokens.push([start, scanner.getTokenText()]);
    before = kind;
  }

  return tokens;
}

/** The code of a source file with every comment blanked, each character left in its place. A JSX file is compiled first: the scanner cannot tell its text from its code. */
function codeOf(path: string, text: string): string {
  const [, loader] = JSX_FILE.exec(path) ?? [];
  const source = loader === "tsx" || loader === "jsx" ? new Bun.Transpiler({ loader }).transformSync(text) : text;
  let code = "";

  for (const [start, token] of codeTokens(source)) code += source.slice(code.length, start).replace(/[^\n]/g, " ") + token;

  return code;
}

/** What the provider's names and words find in the code of one portable source file, as `[rule, path, line, what]`. */
function codeFindings(path: string, text: string): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];
  const code = codeOf(path, text);
  const words = WORD_PLACE.test(path) ? WORDS : [];
  const placed = JSX_FILE.test(path)
    ? (match: RegExpExecArray): number => Math.max(0, text.indexOf(match[0]))
    : (match: RegExpExecArray): number => match.index;

  for (const [rule, pattern] of NAMES) {
    for (const match of code.matchAll(pattern)) found.push([rule, path, lineOf(text, placed(match)), match[0]]);
  }

  for (const [word, pattern] of words) {
    for (const match of code.matchAll(pattern)) found.push(["provider word", path, lineOf(text, placed(match)), word]);
  }

  return found;
}

/** The provider's names, words, and types references in portable source, as `[rule, path, line, what]`. */
function sourceFindings({ root, providers }: Tree): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];
  const folders = providers.map((place) => posix.basename(place));

  for (const path of filesUnder(root, PORTABLE)) {
    const text = readFileSync(join(root, path), "utf8");
    found.push(...codeFindings(path, text));

    for (const match of text.matchAll(REFERENCE)) {
      const [, named = ""] = match;
      const leads = PROVIDER_MODULE.test(named) || named.split("/").some((part) => folders.includes(part));
      if (leads) found.push(["provider types", path, lineOf(text, match.index + match[0].indexOf(named)), named]);
    }
  }

  return found;
}

/** The provider modules a portable place's TypeScript settings name, as `[rule, path, line, name]`. */
function settingsFindings(root: string): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];

  for (const path of filesUnder(root, PORTABLE, SETTINGS_FILE)) {
    const text = readFileSync(join(root, path), "utf8");

    for (const match of text.matchAll(/"([^"\n]+)"/g)) {
      if (PROVIDER_MODULE.test(match[1] ?? "")) found.push(["provider types", path, lineOf(text, match.index), match[1] ?? ""]);
    }
  }

  return found;
}

/** The provider dependencies in the manifests of the packages that are portable whole, as `[rule, path, line, name]`. */
function manifestFindings({ root, packages, providers }: Tree): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];
  const providerPackages = [...packages].filter(([, folder]) => providers.includes(folder)).map(([name]) => name);

  for (const place of PORTABLE.filter((path) => repositoryFiles(root).includes(`${path}/package.json`))) {
    const text = readFileSync(join(root, place, "package.json"), "utf8");
    const manifest: Record<string, Record<string, string> | undefined> = JSON.parse(text);
    const names = DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}));

    for (const name of names.filter((dependency) => PROVIDER_MODULE.test(dependency) || providerPackages.includes(dependency))) {
      found.push(["provider dependency", `${place}/package.json`, lineOf(text, text.indexOf(`"${name}"`)), name]);
    }
  }

  return found;
}

/** Every place portable code names a provider with no import, as `<rule>: <path>:<line>: <what>`, less the allowed findings; an allowed finding that is gone is named too. */
function violations(root: string, allowed: readonly string[] = []): string[] {
  const tree = readTree(root);
  const found = [...sourceFindings(tree), ...settingsFindings(root), ...manifestFindings(tree)];
  const live = new Set(found.map(([, path, , what]) => `${path}: ${what}`));
  const kept = found.filter(([, path, , what]) => !allowed.includes(`${path}: ${what}`)).map(([rule, path, line, what]) => `${rule}: ${path}:${line}: ${what}`);
  const stale = allowed.filter((finding) => !live.has(finding)).map((finding) => `allowed, but no longer found: ${finding}`);

  return [...new Set([...kept, ...stale])].sort();
}

/** The imports the lint settings let through from a tree's packages into its provider folders, as `<importer> may import <provider>`. Each package is asked by the provider's path and by its name, and a provider is asked about every other. */
function openImports({ packages, providers }: Tree): string[] {
  const pairs = [...PORTABLE, ...providers].flatMap((from) => providers.filter((provider) => provider !== from).map((provider) => ({ from, provider })));
  const probes = pairs.flatMap(({ from, provider }, pair) => {
    const name = [...packages].find(([, folder]) => folder === provider)?.[0];
    const ways = [`../../${posix.basename(provider)}/src/storage/store`, ...(name === undefined ? [] : [name, `${name}/src/storage/store`])];

    return ways.map((way, index) => ({ from, provider, file: `${from}/tests/probe-${pair}-${index}.ts`, text: `import "${way}";\n` }));
  });
  if (probes.length === 0) return [];

  const refused = plantedLint(Object.fromEntries(probes.map(({ file, text }) => [file, text])));
  const open = probes.filter(({ file }) => !refused.includes(`noRestrictedImports: ${file}:1`));

  return [...new Set(open.map(({ from, provider }) => `${from} may import ${provider}`))].sort();
}

describe("provider code stays out of the portable packages", () => {
  test("drift: a provider's module, type, header, or word in portable code would make a second provider a rewrite of the product, not a new adapter", () => {
    expect(
      violations(
        ROOT,
        ALLOWED.map(([file, what]) => `${file}: ${what}`),
      ),
    ).toEqual([]);
    expect(openImports(readTree(ROOT))).toEqual([]);
    expect(filesUnder(ROOT, PORTABLE).length).toBeGreaterThan(0);
    expect(readTree(ROOT).providers.length).toBeGreaterThan(0);
  });

  test("drift: a lint rule that matches nothing passes forever; each row is a leak planted in a throwaway tree that the rule must name, beside code that only looks like one", () => {
    const leaks: readonly (readonly [leak: string, line: string, rule: string, what: string, file?: string])[] = [
      ["the provider's SDK", 'import Cloudflare from "cloudflare";', "noRestrictedImports", "cloudflare"],
      ["a module of the SDK", 'import type { Zone } from "cloudflare/resources/zones";', "noRestrictedImports", "cloudflare/resources/zones"],
      ["the Workers types", 'import type { R2 } from "@cloudflare/workers-types";', "noRestrictedImports", "@cloudflare/workers-types"],
      ["a runtime module", 'import { env } from "cloudflare:workers";', "noRestrictedImports", "cloudflare:workers"],
      ["the deploy tool", 'const { unstable_dev } = await import("wrangler");', "noRestrictedImports", "wrangler"],
      ["the local runtime", 'import { Miniflare } from "miniflare";', "noRestrictedImports", "miniflare"],
      ["a require", 'const sdk = require("cloudflare");', "noCommonJs", "require"],
      ["a require made for the file", 'import { createRequire } from "node:module";', "noRestrictedImports", "node:module"],
      ["a re-export", 'export { buildClient } from "../../../cloudflare/src/zone/client";', "noRestrictedImports", "../../../cloudflare/src/zone/client"],
      ["the Cloudflare package whole", 'import * as provider from "@poplin/cloudflare";', "noRestrictedImports", "@poplin/cloudflare"],
      [
        "the Cloudflare package by name",
        'import { r2Storage } from "@poplin/cloudflare/src/storage/r2";',
        "noRestrictedImports",
        "@poplin/cloudflare/src/storage/r2",
      ],
      [
        "the Cloudflare package by path",
        'import { r2Storage } from "../../../cloudflare/src/storage/r2.ts";',
        "noRestrictedImports",
        "../../../cloudflare/src/storage/r2.ts",
      ],
      [
        "an import in single quotes",
        "import { open } from '../../../cloudflare/src/database/d1';",
        "noRestrictedImports",
        "../../../cloudflare/src/database/d1",
      ],
      ["an import for its effect", 'import "../../../cloudflare/src/worker/worker";', "noRestrictedImports", "../../../cloudflare/src/worker/worker"],
      ["an import broken over lines", 'import {\n  buildClient,\n} from\n  "cloudflare";', "noRestrictedImports", "cloudflare"],
      ["an import with a comment line inside it", 'import { buildClient } from\n// The client.\n"cloudflare";', "noRestrictedImports", "cloudflare"],
      [
        "an import after a URL in the text of a JSX file",
        'export const hint = <p>https://example.com</p>;\nimport "cloudflare";',
        "noRestrictedImports",
        "cloudflare",
        "planted.tsx",
      ],
      ["the Worker's context", "function serve(request: Request, context: ExecutionContext): Response {}", "noRestrictedTypes", "ExecutionContext"],
      [
        "the Worker's context in a JSX file",
        "export const Page = ({ context }: { context: ExecutionContext }) => <p>it's {String(context)}</p>;",
        "noRestrictedTypes",
        "ExecutionContext",
        "page.tsx",
      ],
      ["the Worker's handler", "const handler: ExportedHandler = {};", "noRestrictedTypes", "ExportedHandler"],
      ["the bindings record", "function serve(request: Request, env: Env): Response {}", "noRestrictedTypes", "Env"],
      ["the bindings record, by its other name", "type App = { Bindings: Bindings };", "noRestrictedTypes", "Bindings"],
      ["the bindings record, as its framework names it", "type App = { Bindings: CloudflareBindings };", "noRestrictedTypes", "CloudflareBindings"],
      ["the stream rewriter", "const page = new HTMLRewriter().transform(response);", "noRestrictedGlobals", "HTMLRewriter"],
      ["the stream of a known length", "const { readable, writable } = new FixedLengthStream(size);", "noRestrictedGlobals", "FixedLengthStream"],
      ["the socket pair", "const [client, server] = Object.values(new WebSocketPair());", "noRestrictedGlobals", "WebSocketPair"],
    ];
    const providerFree = [
      "// Bindings of keys to actions, one Env per test.",
      'const label = "Env";',
      'const letters = Array.from("wrangler");',
      '// import { r2Storage } from "@poplin/cloudflare/src/storage/r2";',
      '/* const sdk = require("cloudflare"); */',
      'import { parseHostname } from "@poplin/app/src/names/hostname";',
      'import { open } from "../database/open";',
      'import * as v from "valibot";',
      "const rewriter = { HTMLRewriter: 1 }.HTMLRewriter;",
    ].join("\n");
    const planted = leaks.map(([, line, rule, what, file = "planted.ts"], row) => ({
      path: `packages/cli/tests/row-${row}/${file}`,
      text: `// A planted file.\n${line}\n`,
      found: `${rule}: packages/cli/tests/row-${row}/${file}:${1 + lineOf(line, line.indexOf(what))}`,
    }));
    const files = Object.fromEntries(planted.map(({ path, text }) => [path, text]));

    expect(plantedLint({ ...files, "packages/cli/tests/provider-free.ts": providerFree })).toEqual(planted.map(({ found }) => found).sort());
  });

  test("drift: every portable place is under the rules, the dashboard's two among them, and the provider's own folders and the rest of the tree are not: a rule on the wrong places is switched off the day it fires", () => {
    const leak = 'import Cloudflare from "cloudflare";\nexport const page = new HTMLRewriter();\nexport type Context = ExecutionContext;\n';
    const outside = [
      "packages/cloudflare/src/storage/r2.ts",
      "packages/cloudflare/tests/storage/r2.test.ts",
      "tests/planted.test.ts",
      "website/src/planted.ts",
      ".github/scripts/planted.ts",
    ];
    const kept = "packages/app/tests/dashboard/support/markup.ts";
    const refused = plantedLint({
      ...Object.fromEntries([...PORTABLE_PLACES, ...outside].map((path) => [path, leak])),
      [kept]: "export const page = new HTMLRewriter();\nexport const stream = new FixedLengthStream(1);\n",
    });

    expect(refused).toEqual(
      [
        `noRestrictedGlobals: ${kept}:2`,
        ...PORTABLE_PLACES.flatMap((path) => [`noRestrictedImports: ${path}:1`, `noRestrictedGlobals: ${path}:2`, `noRestrictedTypes: ${path}:3`]),
      ].sort(),
    );
  });

  test("drift: code that runs in a browser or in any runtime names none: the dashboard's source and core's are refused a runtime's module and global, and a tool or a test beside the dashboard's source is not", () => {
    const reach =
      'import { readFileSync } from "node:fs";\nimport { serve } from "bun";\nimport { Database } from "bun:sqlite";\nexport const used = [readFileSync, serve, Database];\n';
    const globals = "export const home = process.env.HOME;\nexport const file = Bun.file(home);\nexport const bytes = Buffer.from(home);\n";

    expect(
      plantedLint({
        "packages/dashboard/src/pages/planted.tsx": `${reach}${globals}export const page = <p>{home}</p>;\n`,
        "packages/dashboard/vite.config.ts": `${reach}${globals}`,
        "packages/dashboard/tests/planted.test.tsx": `${reach}${globals}`,
        "packages/core/src/storage/planted.ts": `${reach}import { Hono } from "hono";\nexport const app = new Hono();\n`,
      }),
    ).toEqual([
      "noNodejsModules: packages/core/src/storage/planted.ts:1",
      "noNodejsModules: packages/dashboard/src/pages/planted.tsx:1",
      "noRestrictedGlobals: packages/dashboard/src/pages/planted.tsx:5",
      "noRestrictedGlobals: packages/dashboard/src/pages/planted.tsx:6",
      "noRestrictedGlobals: packages/dashboard/src/pages/planted.tsx:7",
      "noRestrictedImports: packages/core/src/storage/planted.ts:2",
      "noRestrictedImports: packages/core/src/storage/planted.ts:3",
      "noRestrictedImports: packages/core/src/storage/planted.ts:5",
      "noRestrictedImports: packages/dashboard/src/pages/planted.tsx:2",
      "noRestrictedImports: packages/dashboard/src/pages/planted.tsx:3",
    ]);
  });

  test("drift: the lint rule names the one provider there is, so a second provider's folder is open to every package, and the first to it, until the settings name both", () => {
    using tree = plantedRepository({
      "packages/core/package.json": '{ "name": "@poplin/core" }',
      "packages/cloudflare/package.json": '{ "name": "@poplin/cloudflare" }',
      "packages/other/package.json": '{ "name": "@poplin/other" }',
    });

    expect(openImports(readTree(tree.path))).toEqual([
      "packages/app may import packages/other",
      "packages/cli may import packages/other",
      "packages/cloudflare may import packages/other",
      "packages/core may import packages/other",
      "packages/dashboard may import packages/other",
      "packages/demo may import packages/other",
      "packages/other may import packages/cloudflare",
    ]);
  });

  // Drift: a guard that matches nothing passes forever; each row is a leak planted in a throwaway tree that the guard must name. It is planted outside `src`, where no word is read, so each row shows its one rule alone.
  test.each([
    ["a bucket binding", "function open(bucket: R2Bucket): Storage {", "provider type", "R2Bucket"],
    ["a database binding", "const rows = await (driver as D1Database).batch(statements);", "provider type", "D1Database"],
    ["a key-value binding, under a namespace", "type Cache = Workers.KVNamespace;", "provider type", "KVNamespace"],
    ["a durable object", "type Counter = DurableObjectNamespace;", "provider type", "DurableObjectNamespace"],
    ["a durable object's storage", "type Kept = DurableObjectStorage;", "provider type", "DurableObjectStorage"],
    ["the generated namespace", "type Vars = Cloudflare.Env;", "provider type", "Cloudflare.Env"],
    ["the stream rewriter, as a member of the global", "const Parser = globalThis.HTMLRewriter;", "provider global", "globalThis.HTMLRewriter"],
    ["the socket pair, read from the global by key", 'const Pair = globalThis["WebSocketPair"];', "provider global", 'globalThis["WebSocketPair'],
    ["a types reference", '/// <reference types="@cloudflare/workers-types" />', "provider types", "@cloudflare/workers-types"],
    [
      "a reference into the provider's folder",
      '/// <reference path="../../../cloudflare/worker-configuration.d.ts" />',
      "provider types",
      "../../../cloudflare/worker-configuration.d.ts",
    ],
    ["the edge cache", "const cached = await caches.default.match(request);", "provider global", "caches.default"],
    ["work kept going after the answer", "context.waitUntil (sweep(install));", "provider global", ".waitUntil"],
    ["the request's cf object", "const country = request.cf?.country;", "provider request property", ".cf"],
    ["the cf object read by key", 'const country = request["cf"];', "provider request property", '["cf"]'],
    ["the cf object taken apart", "function country({ cf }: Request): string {", "provider request property", "cf"],
    ["the cf options of a fetch", "const response = await fetch(url, { cf: { cacheTtl: 60 } });", "provider request property", "cf"],
    ["the visitor's address header", 'const address = request.headers.get("CF-Connecting-IP");', "provider header", "CF-Connecting-IP"],
    ["the Access token header", 'const token = headers.get("Cf-Access-Jwt-Assertion");', "provider header", "Cf-Access-Jwt-Assertion"],
    ["the ray header", "const ray = headers.get(`cf-ray`);", "provider header", "cf-ray"],
    ["the Access cookie", 'const token = cookies.get("CF_Authorization");', "provider header", "CF_Authorization"],
    ["the clearance cookie", 'const clearance = cookies.get("cf_clearance");', "provider header", "cf_clearance"],
    ["the provider's API", 'const zones = await fetch("https://api.cloudflare.com/client/v4/zones");', "provider host", "api.cloudflare.com"],
    ["the Access team's host", 'const keys = await fetch("https://team.cloudflareaccess.com/cdn-cgi/access/certs");', "provider host", "cloudflareaccess.com"],
  ])("names %s", (_, line, rule, what) => {
    using tree = plantedRepository({
      "packages/cloudflare/package.json": '{ "name": "@poplin/cloudflare" }',
      "packages/cli/tests/sites/planted.ts": `// A planted file.\n${line}\n`,
    });
    const at = 1 + lineOf(line, line.indexOf(what));

    expect(violations(tree.path)).toEqual([`${rule}: packages/cli/tests/sites/planted.ts:${at}: ${what}`]);
  });

  // Drift: a provider's word in a name or a text ties the product's own code and pages to that provider with no import to give it away.
  test.each([
    ["the provider in a text", 'const label = "A Cloudflare API token";', "cloudflare"],
    ["the provider in a name", "const cloudflareToken = read();", "cloudflare"],
    ["its hosts, after a `//` inside a template", `const address = \`\${scheme}://\${name}.example.workers.dev\`;`, "workers.dev"],
    ["its bucket in a name", "const store = openR2(bucket);", "R2"],
    ["its bucket as a key", "const kinds = { r2: 1 };", "R2"],
    ["its database in a name", "const kinds = { d1Database: 2 };", "D1"],
    ["its runtime in a text", 'const hint = "its Worker stores them when it starts";', "worker"],
    ["its runtime in a name", "const workerName = read();", "worker"],
    ["its runtime in a file's name", 'const entry = "worker.dev.ts";', "worker"],
    ["its deploy tool, after a regular expression that holds a `/*`", "const marked = /[/*]/.test(wranglerNote);", "wrangler"],
    ["its deploy tool, in a text no import reads", 'const letters = Array.from("wrangler");', "wrangler"],
    ["its word for a domain in a name", "const zoneId = read();", "zone"],
    ["its word for a domain in a text", 'const meaning = "The zone\'s bot switches.";', "zone"],
  ])("names %s", (_, line, word) => {
    using tree = plantedRepository({ "packages/app/src/dashboard/planted.ts": `// A planted file.\n${line}\n` });

    expect(violations(tree.path)).toEqual([`provider word: packages/app/src/dashboard/planted.ts:2: ${word}`]);
  });

  test("drift: a JSX file was refused whole, so the dashboard could hold none; its names, texts, and markup are read, and its comments are not", () => {
    using tree = plantedRepository({
      "packages/dashboard/src/pages/planted.tsx": [
        "// A page served on Cloudflare, in a comment.",
        "export function Page({ request, zoneId }: { request: Request; zoneId: string }): unknown {",
        "  const country = request.cf?.country; // of the Worker",
        "  return (",
        "    <main>",
        "      {/* wrangler, in a comment */}",
        "      <p>https://example.com it's kept in R2</p>",
        '      <a href="https://team.cloudflareaccess.com/">{country}</a>',
        "    </main>",
        "  );",
        "}",
      ].join("\n"),
      "packages/dashboard/tests/pages/planted.test.tsx": 'export const hint = <p title="CF-Ray">https://example.com is no Worker</p>;\n',
    });

    expect(violations(tree.path)).toEqual([
      "provider header: packages/dashboard/tests/pages/planted.test.tsx:1: CF-Ray",
      "provider host: packages/dashboard/src/pages/planted.tsx:8: cloudflareaccess.com",
      "provider request property: packages/dashboard/src/pages/planted.tsx:3: .cf",
      "provider word: packages/dashboard/src/pages/planted.tsx:2: zone",
      "provider word: packages/dashboard/src/pages/planted.tsx:7: R2",
      "provider word: packages/dashboard/src/pages/planted.tsx:8: cloudflare",
    ]);
  });

  test("drift: a portable package whose manifest or TypeScript settings name the provider takes it in with no import to give it away", () => {
    using tree = plantedRepository({
      "packages/cloudflare/package.json": '{ "name": "@poplin/cloudflare" }',
      "packages/core/package.json":
        '{\n  "name": "@poplin/core",\n  "dependencies": { "valibot": "1.5.0" },\n  "devDependencies": {\n    "wrangler": "4.0.0",\n    "@poplin/cloudflare": "workspace:*"\n  }\n}\n',
      "packages/cli/tsconfig.json": '{\n  "extends": "../../tsconfig.json",\n  "compilerOptions": { "types": ["bun", "@cloudflare/workers-types"] }\n}\n',
    });

    expect(violations(tree.path)).toEqual([
      "provider dependency: packages/core/package.json:5: wrangler",
      "provider dependency: packages/core/package.json:6: @poplin/cloudflare",
      "provider types: packages/cli/tsconfig.json:3: @cloudflare/workers-types",
    ]);
  });

  test("drift: every portable place is walked, tests included, and an allowed finding is passed over only while it is there", () => {
    const leak = 'const address = request.headers.get("CF-Connecting-IP");\n';
    const places = [...PORTABLE_PLACES, "packages/app/src/login/session.ts", "packages/app/tests/login/session.test.ts"].sort();
    using tree = plantedRepository(Object.fromEntries(places.map((path) => [path, leak])));
    const everyPlace = places.map((path) => `provider header: ${path}:1: CF-Connecting-IP`);

    expect(violations(tree.path)).toEqual(everyPlace);
    expect(violations(tree.path, ["packages/cli/scripts/planted.mts: CF-Connecting-IP", "packages/cli/src/gone.ts: wrangler"])).toEqual([
      "allowed, but no longer found: packages/cli/src/gone.ts: wrangler",
      ...everyPlace.filter((finding) => !finding.includes("packages/cli/scripts/")),
    ]);
  });

  test("drift: the rules bind portable places alone; a guard that fired on the provider's own folders, on a comment, or on provider-free code, would be switched off", () => {
    const providerCode =
      'import Cloudflare from "cloudflare";\nexport function open(env: Env): R2Bucket {\n  return env.BUCKET;\n}\nconst TOKEN_HEADER = "Cf-Access-Jwt-Assertion";\n';
    const portableCode = [
      "// One removal stays inside the subrequests a Worker request gets on Cloudflare's Free plan.",
      'import { parseHostname } from "@poplin/app/src/names/hostname";',
      'import { open } from "../database/open";',
      'import { readSession } from "@poplin/app/src/login/session";',
      'import * as v from "valibot";',
      "const home = machine.env.HOME ?? process.env.HOME;",
      "const tables = \"SELECT name FROM sqlite_master WHERE name NOT LIKE '_cf_%'\";",
      'const address = headers.get("X-Forwarded-For");',
      "const config = this.cf();",
      "// Rules from https://developers.cloudflare.com/cache/ apply to any shared cache.",
      "// The CF-Connecting-IP header and request.cf are read at https://api.cloudflare.com/ alone.",
      "/* context.waitUntil(sweep) keeps caches.default warm, as Cloudflare.Env says of an R2Bucket. */",
      "const sizes = { rcf: 1, cfg: 2 };",
      "/** The zone's bot switches, which wrangler sets on the Worker at workers.dev, beside its R2 and its D1. */",
      "const kinds = { r2d2: 1, id1: 2, grid12: 3 };",
      'const shown = new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(now); // in the time zone of the Worker',
      'const label = "the time zone";',
      "const share = total / count; // per Worker",
      "const ratio = total++ / count; // on Cloudflare",
      `const address = \`\${origin}//\${path}\`; /* wrangler */`,
    ].join("\n");
    const namedOutsideSource = 'const label = "A Cloudflare Worker reads R2 and D1 in the zone.";\n';
    using tree = plantedRepository({
      "packages/app/package.json": '{ "name": "@poplin/app" }',
      "packages/cloudflare/package.json":
        '{ "name": "@poplin/cloudflare", "dependencies": { "cloudflare": "7.3.0" }, "devDependencies": { "wrangler": "4.0.0" } }',
      "packages/cloudflare/src/storage/r2.ts": providerCode,
      "packages/cloudflare/src/zone/client.ts": providerCode,
      "packages/cloudflare/src/login/access-token.ts": providerCode,
      "packages/cloudflare/src/login/keys.ts": providerCode,
      "packages/cli/node_modules/wrangler/index.js": providerCode,
      "packages/cli/dist/bin.mjs": providerCode,
      "packages/cli/README.md": providerCode,
      "packages/cli/tsconfig.json": '{ "compilerOptions": { "types": ["bun"] } }',
      "packages/core/src/storage/current.ts": portableCode,
      "packages/core/tests/storage/named.test.ts": namedOutsideSource,
      "packages/cli/scripts/named.mts": namedOutsideSource,
    });

    expect(violations(tree.path)).toEqual([]);
  });

  // Drift: a guard that lists the disk reads what is no part of the repository, and fails in the one checkout that holds it.
  test("a file the repository is told to leave out is not read: a local scratch file, a local package, and a build folder are no part of it, a new file not yet added is", () => {
    const leak = 'const address = request.headers.get("CF-Connecting-IP");\n';
    using tree = plantedRepository(
      {
        "packages/core/src/storage/added.ts": leak,
        "packages/core/src/storage/scratch.ts": leak,
        "packages/core/built/bundle.js": leak,
        "packages/core/built/page.tsx": leak,
        "packages/other/package.json": '{ "name": "@poplin/other" }',
        "packages/local/package.json": '{ "name": "@poplin/local" }',
        "packages/core/package.json":
          '{\n  "name": "@poplin/core",\n  "dependencies": {\n    "@poplin/other": "workspace:*",\n    "@poplin/local": "workspace:*"\n  }\n}\n',
      },
      { excluded: ["scratch.ts", "/packages/local/"], ignored: ["built/"] },
    );

    expect(violations(tree.path)).toEqual([
      "provider dependency: packages/core/package.json:4: @poplin/other",
      "provider header: packages/core/src/storage/added.ts:1: CF-Connecting-IP",
    ]);
  });
});
