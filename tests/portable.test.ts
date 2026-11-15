// Scope: this catches a provider named in portable source or in its package and TypeScript settings, and one provider's code reaching another's. A name built at run time and a type that copies a binding's shape are out of scope.
//
// The provider's words are read in the code of a portable `src` folder, comments apart, by these rules:
//
//   cloudflare, wrangler, workers.dev   any case, anywhere in a name or a text
//   worker                              any case: a browser's own worker is an allowed row, by file
//   zone                                any case, but `timeZone` and "time zone"
//   R2, D1                              a whole word or a part of a name (`r2`, `openR2`, `d1Database`), never inside a longer run such as `r2d2`
//
// A JSX file is refused whole, wherever it is read: its text cannot be told from its code without a parser.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

import { SyntaxKind } from "typescript/unstable/ast";
import { createScanner } from "typescript/unstable/ast/scanner";

import { plantedRepository, repositoryFiles } from "./support/repository-files";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The folders that hold no provider: another provider is added without touching them. Every other folder of `packages` is one provider's own. */
const PORTABLE: readonly string[] = ["packages/core", "packages/app", "packages/cli", "packages/demo"];

/** The part of a portable package whose code is read for the provider's words. */
const WORD_PLACE = /^packages\/[^/]+\/src\//;

/** The provider's own modules, as an import path or a manifest dependency. */
const PROVIDER_MODULE = /^(?:cloudflare(?:[:/].*)?|@cloudflare\/.*|wrangler(?:\/.*)?|miniflare(?:\/.*)?)$/;

/** The provider's names in source text: its binding and handler types, its globals, the `cf` object on a request, the headers and cookies only it sends, and its own hosts. */
const FORBIDDEN: readonly (readonly [rule: string, pattern: RegExp])[] = [
  [
    "provider type",
    /\b(?:R2[A-Z]\w*|D1[A-Z]\w*|KVNamespace\w*|DurableObject\w*|ExecutionContext|ExportedHandler|CloudflareBindings|Env|Bindings)\b|\bCloudflare\.[A-Z]\w*/g,
  ],
  ["provider global", /\bHTMLRewriter\b|\bcaches\.default\b|\bFixedLengthStream\b|\bWebSocketPair\b|\.waitUntil(?=\s*\()/g],
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
  ["packages/app/tests/dashboard/support/markup.ts", "HTMLRewriter", "the test runner's own HTML parser, which reads a page in the dashboard's tests; no page of the product is built with it"],
];

/** The files that are read as source. */
const SOURCE_FILE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;

/** The source files that hold JSX, which are refused unread. */
const JSX_FILE = /\.[jt]sx$/;

/** A folder of `packages`, at the start of the path of a file in it. */
const PACKAGE_FOLDER = /^packages\/[^/]+(?=\/)/;

/** The folders whose files are never read: installed and built code. */
const SKIPPED_FOLDERS: readonly string[] = ["node_modules", "dist"];

/** The TypeScript settings files, whose `types` load a module's globals with no import. */
const SETTINGS_FILE = /^tsconfig.*\.json$/;

/** The words a path follows in an import, a re-export, a dynamic import, and a require. */
const IMPORT_WORDS: ReadonlySet<string> = new Set(["from", "import", "require"]);

/** A token that is one quoted text with nothing put into it; the second group is the text. */
const QUOTED = /^(["'`])([^"'`\n]+)\1$/;

/** A reference directive, the one import that is a comment; the first group is the path. */
const REFERENCE = /^\s*\/\/\/\s*<reference\s+(?:types|path)=["']([^"'\n]+)["']/gm;

/** The manifest fields that name what a package depends on. */
const DEPENDENCY_FIELDS: readonly string[] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

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

/** Where an import path leads inside the repository, without its extension; `undefined` for a module from outside. */
function importedPath(specifier: string, importer: string, packages: ReadonlyMap<string, string>): string | undefined {
  if (specifier.startsWith(".")) return posix.join(dirname(importer), specifier);

  for (const [name, folder] of packages) {
    if (isUnder(specifier, name)) return posix.join(folder, specifier.slice(name.length));
  }

  return undefined;
}

/** The provider an import leads into; `undefined` for a module from outside and for a portable one. */
function providerOf(specifier: string, importer: string, tree: Tree): string | undefined {
  const target = importedPath(specifier, importer, tree.packages);
  if (target === undefined) return undefined;

  return tree.providers.find((place) => isUnder(target, place));
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

/** The imports of one source file, as `[line, path]`. The tokens are read, so a comment inside a statement hides nothing and an import inside a comment is none. */
function importsOf(text: string): [number, string][] {
  const tokens = codeTokens(text);
  const found: [number, string][] = [];

  for (const [index, [, word]] of tokens.entries()) {
    if (!IMPORT_WORDS.has(word)) continue;

    const after = tokens[index + 1]?.[1] === "(" ? tokens[index + 2] : tokens[index + 1];
    const path = QUOTED.exec(after?.[1] ?? "")?.[2];
    if (after !== undefined && path !== undefined) found.push([lineOf(text, after[0]), path]);
  }

  for (const match of text.matchAll(REFERENCE)) found.push([lineOf(text, match.index + match[0].indexOf(match[1] ?? "")), match[1] ?? ""]);

  return found;
}

/** The provider's words in the code of one source file, as `[rule, path, line, word]`. */
function wordFindings(path: string, text: string): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];

  for (const [start, token] of codeTokens(text)) {
    for (const [word, pattern] of WORDS) {
      for (const match of token.matchAll(pattern)) found.push(["provider word", path, lineOf(text, start + match.index), word]);
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

/** The provider's imports, names, and words in portable source, as `[rule, path, line, what]`. */
function sourceFindings(tree: Tree): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];

  for (const path of filesUnder(tree.root, PORTABLE)) {
    const text = readFileSync(join(tree.root, path), "utf8");

    for (const [line, specifier] of importsOf(text)) {
      if (PROVIDER_MODULE.test(specifier) || providerOf(specifier, path, tree) !== undefined) found.push(["provider import", path, line, specifier]);
    }

    for (const [rule, pattern] of FORBIDDEN) {
      for (const match of text.matchAll(pattern)) found.push([rule, path, lineOf(text, match.index), match[0]]);
    }

    if (WORD_PLACE.test(path)) found.push(...wordFindings(path, text));
  }

  return found;
}

/** The imports that lead from one provider's folder into another's, as `[rule, path, line, path imported]`. */
function crossFindings(tree: Tree): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];

  for (const path of filesUnder(tree.root, tree.providers)) {
    const own = tree.providers.find((place) => isUnder(path, place));

    for (const [line, specifier] of importsOf(readFileSync(join(tree.root, path), "utf8"))) {
      const other = providerOf(specifier, path, tree);
      if (other !== undefined && other !== own) found.push(["provider to provider import", path, line, specifier]);
    }
  }

  return found;
}

/** The JSX files of every package, as `[rule, path, line, what]`. */
function jsxFindings(tree: Tree): [string, string, number, string][] {
  return filesUnder(tree.root, [...PORTABLE, ...tree.providers], JSX_FILE).map((path) => ["unread source", path, 1, "JSX"]);
}

/** Every place portable code reaches a provider, or one provider another, as `<rule>: <path>:<line>: <what>`, less the allowed findings; an allowed finding that is gone is named too. */
function violations(root: string, allowed: readonly string[] = []): string[] {
  const tree = readTree(root);
  const found = [...sourceFindings(tree), ...crossFindings(tree), ...jsxFindings(tree), ...settingsFindings(root), ...manifestFindings(tree)];
  const live = new Set(found.map(([, path, , what]) => `${path}: ${what}`));
  const kept = found.filter(([, path, , what]) => !allowed.includes(`${path}: ${what}`)).map(([rule, path, line, what]) => `${rule}: ${path}:${line}: ${what}`);
  const stale = allowed.filter((finding) => !live.has(finding)).map((finding) => `allowed, but no longer found: ${finding}`);

  return [...new Set([...kept, ...stale])].sort();
}

describe("provider code stays out of the portable packages", () => {
  test("drift: a provider's module, type, header, or word in portable code would make a second provider a rewrite of the product, not a new adapter", () => {
    expect(
      violations(
        ROOT,
        ALLOWED.map(([file, what]) => `${file}: ${what}`),
      ),
    ).toEqual([]);
    expect(filesUnder(ROOT, PORTABLE).length).toBeGreaterThan(0);
    expect(readTree(ROOT).providers.length).toBeGreaterThan(0);
  });

  // Drift: a guard that matches nothing passes forever; each row is a leak planted in a throwaway tree that the guard must name. It is planted outside `src`, where no word is read, so each row shows its one rule alone.
  test.each([
    ["the provider's SDK", 'import Cloudflare from "cloudflare";', "provider import", "cloudflare"],
    ["a module of the SDK", 'import type { Zone } from "cloudflare/resources/zones";', "provider import", "cloudflare/resources/zones"],
    ["the Workers types", 'import type { R2 } from "@cloudflare/workers-types";', "provider import", "@cloudflare/workers-types"],
    ["a runtime module", 'import { env } from "cloudflare:workers";', "provider import", "cloudflare:workers"],
    ["the deploy tool", 'const { unstable_dev } = await import("wrangler");', "provider import", "wrangler"],
    ["a require", 'const sdk = require("cloudflare");', "provider import", "cloudflare"],
    ["a re-export", 'export { buildClient } from "../../../cloudflare/src/zone/client";', "provider import", "../../../cloudflare/src/zone/client"],
    ["the Cloudflare package by name", 'import { r2Storage } from "@poplin/cloudflare/src/storage/r2";', "provider import", "@poplin/cloudflare/src/storage/r2"],
    ["the Cloudflare package by path", 'import { r2Storage } from "../../../cloudflare/src/storage/r2.ts";', "provider import", "../../../cloudflare/src/storage/r2.ts"],
    [
      "the Access token check",
      'import { verifyAccessToken } from "@poplin/cloudflare/src/login/access-token";',
      "provider import",
      "@poplin/cloudflare/src/login/access-token",
    ],
    ["an import broken over lines", 'import {\n  buildClient,\n} from\n  "cloudflare";', "provider import", "cloudflare"],
    ["an import with a comment line inside it", 'import { buildClient } from\n// The client.\n"cloudflare";', "provider import", "cloudflare"],
    ["a bucket binding", "function open(bucket: R2Bucket): Storage {", "provider type", "R2Bucket"],
    ["a database binding", "const rows = await (driver as D1Database).batch(statements);", "provider type", "D1Database"],
    ["a key-value binding", "type Cache = KVNamespace;", "provider type", "KVNamespace"],
    ["a durable object", "type Counter = DurableObjectNamespace;", "provider type", "DurableObjectNamespace"],
    ["the Worker's context", "function serve(request: Request, context: ExecutionContext): Response {", "provider type", "ExecutionContext"],
    ["the bindings record", "function serve(request: Request, env: Env): Response {", "provider type", "Env"],
    ["the bindings record, by its other name", "type App = { Bindings: Bindings };", "provider type", "Bindings"],
    ["the generated namespace", "type Vars = Cloudflare.Env;", "provider type", "Cloudflare.Env"],
    ["a types reference", '/// <reference types="@cloudflare/workers-types" />', "provider import", "@cloudflare/workers-types"],
    ["the edge cache", "const cached = await caches.default.match(request);", "provider global", "caches.default"],
    ["the stream rewriter", "const page = new HTMLRewriter().transform(response);", "provider global", "HTMLRewriter"],
    ["the stream of a known length", "const { readable, writable } = new FixedLengthStream(size);", "provider global", "FixedLengthStream"],
    ["the socket pair", "const [client, server] = Object.values(new WebSocketPair());", "provider global", "WebSocketPair"],
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
      "packages/app/package.json": '{ "name": "@poplin/app" }',
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
    ["its word for a domain in a name", "const zoneId = read();", "zone"],
    ["its word for a domain in a text", 'const meaning = "The zone\'s bot switches.";', "zone"],
  ])("names %s", (_, line, word) => {
    using tree = plantedRepository({ "packages/app/src/dashboard/planted.ts": `// A planted file.\n${line}\n` });

    expect(violations(tree.path)).toEqual([`provider word: packages/app/src/dashboard/planted.ts:2: ${word}`]);
  });

  test("drift: a URL in the text of a JSX file reads as a comment, so a provider's word or an import after it would pass unseen", () => {
    using tree = plantedRepository({
      "packages/app/src/dashboard/planted.tsx": 'export const hint = <p>https://example.com</p>; export const cloudflareToken = "";\n',
      "packages/app/tests/dashboard/planted.tsx": 'export const hint = <p>https://example.com</p>; import "cloudflare";\n',
      "packages/other/src/planted.jsx": 'export const hint = <p>https://example.com</p>; export { listed } from "../../cloudflare/src/storage/r2";\n',
    });

    expect(violations(tree.path)).toEqual([
      "unread source: packages/app/src/dashboard/planted.tsx:1: JSX",
      "unread source: packages/app/tests/dashboard/planted.tsx:1: JSX",
      "unread source: packages/other/src/planted.jsx:1: JSX",
    ]);
  });

  test("drift: a second provider that leans on the first could not be shipped, or removed, by itself", () => {
    using tree = plantedRepository({
      "packages/core/package.json": '{ "name": "@poplin/core" }',
      "packages/cloudflare/package.json": '{ "name": "@poplin/cloudflare" }',
      "packages/other/package.json": '{ "name": "@poplin/other" }',
      "packages/other/src/storage/store.ts": [
        'import { listed } from "@poplin/cloudflare/src/storage/r2";',
        'import { open } from "../../../cloudflare/src/database/d1";',
        'import type { ObjectStore } from "@poplin/core/src/storage/storage";',
        'import { own } from "./own";',
      ].join("\n"),
      "packages/cloudflare/src/storage/r2.ts": 'import { own } from "../database/d1";\n',
      "packages/app/src/api/planted.ts": 'import { store } from "@poplin/other/src/storage/store";\n',
    });

    expect(violations(tree.path)).toEqual([
      "provider import: packages/app/src/api/planted.ts:1: @poplin/other/src/storage/store",
      "provider to provider import: packages/other/src/storage/store.ts:1: @poplin/cloudflare/src/storage/r2",
      "provider to provider import: packages/other/src/storage/store.ts:2: ../../../cloudflare/src/database/d1",
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
    const leak = "const page = new HTMLRewriter();\n";
    using tree = plantedRepository({
      "packages/core/src/storage/planted.ts": leak,
      "packages/core/tests/planted.test.ts": leak,
      "packages/cli/scripts/planted.mts": leak,
      "packages/app/src/api/planted.ts": leak,
      "packages/app/src/sites/planted.ts": leak,
      "packages/app/src/limits/planted.ts": leak,
      "packages/app/src/login/login.ts": leak,
      "packages/app/src/login/session.ts": leak,
      "packages/app/src/login/return-path.ts": leak,
      "packages/app/tests/sites/planted.ts": leak,
      "packages/app/tests/limits/planted.test.ts": leak,
      "packages/app/tests/login/session.test.ts": leak,
      "packages/app/tests/login/return-path.test.ts": leak,
    });
    const everyPlace = [
      "provider global: packages/app/src/api/planted.ts:1: HTMLRewriter",
      "provider global: packages/app/src/limits/planted.ts:1: HTMLRewriter",
      "provider global: packages/app/src/login/login.ts:1: HTMLRewriter",
      "provider global: packages/app/src/login/return-path.ts:1: HTMLRewriter",
      "provider global: packages/app/src/login/session.ts:1: HTMLRewriter",
      "provider global: packages/app/src/sites/planted.ts:1: HTMLRewriter",
      "provider global: packages/app/tests/limits/planted.test.ts:1: HTMLRewriter",
      "provider global: packages/app/tests/login/return-path.test.ts:1: HTMLRewriter",
      "provider global: packages/app/tests/login/session.test.ts:1: HTMLRewriter",
      "provider global: packages/app/tests/sites/planted.ts:1: HTMLRewriter",
      "provider global: packages/cli/scripts/planted.mts:1: HTMLRewriter",
      "provider global: packages/core/src/storage/planted.ts:1: HTMLRewriter",
      "provider global: packages/core/tests/planted.test.ts:1: HTMLRewriter",
    ];

    expect(violations(tree.path)).toEqual(everyPlace);
    expect(violations(tree.path, ["packages/cli/scripts/planted.mts: HTMLRewriter", "packages/cli/src/gone.ts: wrangler"])).toEqual([
      "allowed, but no longer found: packages/cli/src/gone.ts: wrangler",
      ...everyPlace.filter((finding) => !finding.includes("packages/cli/")),
    ]);
  });

  test("drift: the rules bind portable places alone; a guard that fired on the provider's own folders, or on provider-free code, would be switched off", () => {
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
      "const sizes = { rcf: 1, cfg: 2 };",
      '// import { r2Storage } from "@poplin/cloudflare/src/storage/r2";',
      '/* const sdk = require("cloudflare"); */',
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
      "packages/cloudflare/package.json": '{ "name": "@poplin/cloudflare", "dependencies": { "cloudflare": "7.3.0" }, "devDependencies": { "wrangler": "4.0.0" } }',
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
    const leak = 'import Cloudflare from "cloudflare";\n';
    using tree = plantedRepository(
      {
        "packages/core/src/storage/added.ts": leak,
        "packages/core/src/storage/scratch.ts": leak,
        "packages/core/built/bundle.js": leak,
        "packages/core/built/page.tsx": leak,
        "packages/other/package.json": '{ "name": "@poplin/other" }',
        "packages/local/package.json": '{ "name": "@poplin/local" }',
        "packages/app/src/api/reach.ts": 'import { store } from "@poplin/other/src/store";\nimport { note } from "@poplin/local/src/note";\n',
      },
      { excluded: ["scratch.ts", "/packages/local/"], ignored: ["built/"] },
    );

    expect(violations(tree.path)).toEqual([
      "provider import: packages/app/src/api/reach.ts:1: @poplin/other/src/store",
      "provider import: packages/core/src/storage/added.ts:1: cloudflare",
      "provider word: packages/core/src/storage/added.ts:1: cloudflare",
    ]);
  });
});
