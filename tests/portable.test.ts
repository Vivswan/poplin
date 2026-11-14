// Scope: this catches a provider named in portable source or in its package and TypeScript settings; a name built at run time, a re-export through a file in neither list, and a type that copies a binding's shape are out of scope.

import { describe, expect, test } from "bun:test";
import { type DisposableTempDir, existsSync, mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";

/** The repository this file sits in. */
const ROOT = join(import.meta.dir, "..");

/** The folders and files that hold no provider: another provider is added without touching them. One that does not exist is skipped. */
const PORTABLE: readonly string[] = [
  "packages/core",
  "packages/cli",
  "packages/app/src/api",
  "packages/app/src/sites",
  "packages/app/src/limits",
  "packages/app/src/login/login.ts",
  "packages/app/src/login/session.ts",
  "packages/app/src/login/return-path.ts",
  "packages/app/tests/sites",
  "packages/app/tests/limits",
  "packages/app/tests/login/session.test.ts",
  "packages/app/tests/login/return-path.test.ts",
];

/** The only places the provider lives: portable source imports nothing from them. */
const PROVIDER: readonly string[] = [
  "packages/worker",
  "packages/app/src/cloudflare",
  "packages/app/src/login/access-token.ts",
  "packages/app/src/login/keys.ts",
  "tofu",
];

/** The provider's own modules, as an import path or a manifest dependency. */
const PROVIDER_MODULE = /^(?:cloudflare(?:[:/].*)?|@cloudflare\/.*|wrangler(?:\/.*)?|miniflare(?:\/.*)?)$/;

/** The provider's names in source text: its binding and handler types, its globals, the `cf` object on a request, the headers and cookies only it sends, and its own hosts. */
const FORBIDDEN: readonly (readonly [rule: string, pattern: RegExp])[] = [
  [
    "provider type",
    /\b(?:R2[A-Z]\w*|D1[A-Z]\w*|KVNamespace\w*|DurableObject\w*|ExecutionContext|ExportedHandler|CloudflareBindings|Env|Bindings)\b|\bCloudflare\.[A-Z]\w*/g,
  ],
  ["provider global", /\bHTMLRewriter\b|\bcaches\.default\b/g],
  ["provider request property", /\.cf\b(?!\s*\()|\[["']cf["']\]|(?<![\w.$"'`-])cf(?=\s*[?:,}])/g],
  ["provider header", /(?<![\w-])cf-[a-z][a-z0-9-]*|(?<![\w-])cf_[a-z]\w*|\b__cf_bm\b|\b__cflb\b/gi],
  ["provider host", /(?:api\.cloudflare|cloudflareaccess|cloudflarestorage)\.com/g],
];

/** The findings on the tree today that another change removes: `<path>: <what was found>`, then the owner and the reason. A row that finds nothing fails, so the list only shrinks. */
const ALLOWED: readonly (readonly [finding: string, owner: string, reason: string])[] = [
  [
    "packages/app/tests/sites/install.ts: ../../src/cloudflare/layout",
    "serving fixtures",
    "the fixture should build its addresses without the provider's layout parser",
  ],
  ["packages/app/tests/login/session.test.ts: CF_Authorization", "session tests", "a provider's cookie name as test noise"],
];

/** The files that count as source. */
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The folders never walked: installed and built code. */
const SKIPPED_FOLDERS: readonly string[] = ["node_modules", "dist"];

/** The TypeScript settings files, whose `types` load a module's globals with no import. */
const SETTINGS_FILE = /^tsconfig.*\.json$/;

/** An import, a re-export, a dynamic import, a require, or a reference directive; the first group is the path. */
const IMPORT = /(?:\bfrom|\bimport|\brequire|<reference\s+(?:types|path)=)\s*\(?\s*(?:\/\*[^*]*\*\/\s*)?["'`]([^"'`\n]+)["'`]/g;

/** The manifest fields that name what a package depends on. */
const DEPENDENCY_FIELDS: readonly string[] = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function isUnder(path: string, place: string): boolean {
  return path === place || path.startsWith(`${place}/`);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Every file of one kind under the portable places that exist, as a path from the root with forward slashes. */
function portableFiles(root: string, kind: RegExp = SOURCE_FILE): string[] {
  const files: string[] = [];

  for (const place of PORTABLE.filter((path) => existsSync(join(root, path)))) {
    if (statSync(join(root, place)).isFile()) {
      if (kind.test(posix.basename(place))) files.push(place);
      continue;
    }

    for (const entry of readdirSync(join(root, place), { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll("\\", "/");
      if (!entry.isFile() || !kind.test(entry.name) || path.split("/").some((part) => SKIPPED_FOLDERS.includes(part))) continue;

      files.push(path);
    }
  }

  return files.sort();
}

/** The workspace's packages: the name a manifest gives, to its folder from the root. */
function workspacePackages(root: string): ReadonlyMap<string, string> {
  const packages = new Map<string, string>();
  if (!existsSync(join(root, "packages"))) return packages;

  for (const { name } of readdirSync(join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const manifest = join(root, "packages", name, "package.json");
    if (!existsSync(manifest)) continue;

    packages.set(JSON.parse(readFileSync(manifest, "utf8")).name, `packages/${name}`);
  }

  return packages;
}

/** Where an import path leads inside the repository, without its extension; `undefined` for a module from outside. */
function importedPath(specifier: string, importer: string, packages: ReadonlyMap<string, string>): string | undefined {
  if (specifier.startsWith(".")) return posix.join(dirname(importer), specifier);

  for (const [name, folder] of packages) {
    if (isUnder(specifier, name)) return posix.join(folder, specifier.slice(name.length));
  }

  return undefined;
}

function isProviderImport(specifier: string, importer: string, packages: ReadonlyMap<string, string>): boolean {
  if (PROVIDER_MODULE.test(specifier)) return true;

  const target = importedPath(specifier, importer, packages)?.replace(SOURCE_FILE, "");
  if (target === undefined) return false;

  return PROVIDER.some((place) => isUnder(target, place.replace(SOURCE_FILE, "")));
}

/** The provider modules a portable place's TypeScript settings name, as `[rule, path, line, name]`. */
function settingsFindings(root: string): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];

  for (const path of portableFiles(root, SETTINGS_FILE)) {
    const text = readFileSync(join(root, path), "utf8");

    for (const match of text.matchAll(/"([^"\n]+)"/g)) {
      if (PROVIDER_MODULE.test(match[1] ?? "")) found.push(["provider types", path, lineOf(text, match.index), match[1] ?? ""]);
    }
  }

  return found;
}

/** The provider dependencies in the manifests of the packages that are portable whole, as `[rule, path, line, name]`. */
function manifestFindings(root: string, packages: ReadonlyMap<string, string>): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];
  const providerPackages = [...packages].filter(([, folder]) => PROVIDER.includes(folder)).map(([name]) => name);

  for (const place of PORTABLE.filter((path) => existsSync(join(root, path, "package.json")))) {
    const text = readFileSync(join(root, place, "package.json"), "utf8");
    const manifest: Record<string, Record<string, string> | undefined> = JSON.parse(text);
    const names = DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {}));

    for (const name of names.filter((dependency) => PROVIDER_MODULE.test(dependency) || providerPackages.includes(dependency))) {
      found.push(["provider dependency", `${place}/package.json`, lineOf(text, text.indexOf(`"${name}"`)), name]);
    }
  }

  return found;
}

/** The provider's imports and names in portable source, as `[rule, path, line, what]`. A file is matched whole, so a statement broken over lines is seen. */
function sourceFindings(root: string, packages: ReadonlyMap<string, string>): [string, string, number, string][] {
  const found: [string, string, number, string][] = [];

  for (const path of portableFiles(root)) {
    const text = readFileSync(join(root, path), "utf8");

    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[1] ?? "";
      if (isProviderImport(specifier, path, packages))
        found.push(["provider import", path, lineOf(text, match.index + match[0].indexOf(specifier)), specifier]);
    }

    for (const [rule, pattern] of FORBIDDEN) {
      for (const match of text.matchAll(pattern)) found.push([rule, path, lineOf(text, match.index), match[0]]);
    }
  }

  return found;
}

/** Every place portable code reaches the provider, as `<rule>: <path>:<line>: <what>`, less the allowed findings; an allowed finding that is gone is named too. */
function violations(root: string, allowed: readonly string[] = []): string[] {
  const packages = workspacePackages(root);
  const found = [...sourceFindings(root, packages), ...settingsFindings(root), ...manifestFindings(root, packages)];
  const live = new Set(found.map(([, path, , what]) => `${path}: ${what}`));
  const kept = found.filter(([, path, , what]) => !allowed.includes(`${path}: ${what}`)).map(([rule, path, line, what]) => `${rule}: ${path}:${line}: ${what}`);
  const stale = allowed.filter((finding) => !live.has(finding)).map((finding) => `allowed, but no longer found: ${finding}`);

  return [...new Set([...kept, ...stale])].sort();
}

/** A throwaway tree holding the given files, outside the repository; it is removed when the caller's scope ends. */
function planted(files: Readonly<Record<string, string>>): DisposableTempDir {
  const tree = mkdtempDisposableSync(join(tmpdir(), "portable-"));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(tree.path, path)), { recursive: true });
    writeFileSync(join(tree.path, path), text);
  }

  return tree;
}

describe("provider code stays out of the portable packages", () => {
  test("drift: a provider's module, type, or header in portable code would make a second provider a rewrite of the product, not a new adapter", () => {
    expect(
      violations(
        ROOT,
        ALLOWED.map(([finding]) => finding),
      ),
    ).toEqual([]);
    expect(portableFiles(ROOT).length).toBeGreaterThan(0);
  });

  // Drift: a guard that matches nothing passes forever; each row is a leak planted in a throwaway tree that the guard must name.
  test.each([
    ["the provider's SDK", 'import Cloudflare from "cloudflare";', "provider import", "cloudflare"],
    ["a module of the SDK", 'import type { Zone } from "cloudflare/resources/zones";', "provider import", "cloudflare/resources/zones"],
    ["the Workers types", 'import type { R2 } from "@cloudflare/workers-types";', "provider import", "@cloudflare/workers-types"],
    ["a runtime module", 'import { env } from "cloudflare:workers";', "provider import", "cloudflare:workers"],
    ["the deploy tool", 'const { unstable_dev } = await import("wrangler");', "provider import", "wrangler"],
    ["a require", 'const sdk = require("cloudflare");', "provider import", "cloudflare"],
    ["a re-export", 'export { buildClient } from "../../../app/src/cloudflare/client";', "provider import", "../../../app/src/cloudflare/client"],
    ["the Worker package by name", 'import { r2Storage } from "@poplin/worker/src/r2";', "provider import", "@poplin/worker/src/r2"],
    ["the Worker package by path", 'import { r2Storage } from "../../../worker/src/r2.ts";', "provider import", "../../../worker/src/r2.ts"],
    [
      "the Access token check",
      'import { verifyAccessToken } from "@poplin/app/src/login/access-token";',
      "provider import",
      "@poplin/app/src/login/access-token",
    ],
    ["an import broken over lines", 'import {\n  buildClient,\n} from\n  "cloudflare";', "provider import", "cloudflare"],
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
    using tree = planted({
      "packages/app/package.json": '{ "name": "@poplin/app" }',
      "packages/worker/package.json": '{ "name": "@poplin/worker" }',
      "packages/cli/src/sites/planted.ts": `// A planted file.\n${line}\n`,
    });
    const at = 1 + lineOf(line, line.indexOf(what));

    expect(violations(tree.path)).toEqual([`${rule}: packages/cli/src/sites/planted.ts:${at}: ${what}`]);
  });

  test("drift: a portable package whose manifest or TypeScript settings name the provider takes it in with no import to give it away", () => {
    using tree = planted({
      "packages/worker/package.json": '{ "name": "@poplin/worker" }',
      "packages/core/package.json":
        '{\n  "name": "@poplin/core",\n  "dependencies": { "valibot": "1.5.0" },\n  "devDependencies": {\n    "wrangler": "4.0.0",\n    "@poplin/worker": "workspace:*"\n  }\n}\n',
      "packages/cli/tsconfig.json": '{\n  "extends": "../../tsconfig.json",\n  "compilerOptions": { "types": ["bun", "@cloudflare/workers-types"] }\n}\n',
    });

    expect(violations(tree.path)).toEqual([
      "provider dependency: packages/core/package.json:5: wrangler",
      "provider dependency: packages/core/package.json:6: @poplin/worker",
      "provider types: packages/cli/tsconfig.json:3: @cloudflare/workers-types",
    ]);
  });

  test("drift: every portable place is walked, tests included, and an allowed finding is passed over only while it is there", () => {
    const leak = 'import Cloudflare from "cloudflare";\n';
    using tree = planted({
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
      "provider import: packages/app/src/api/planted.ts:1: cloudflare",
      "provider import: packages/app/src/limits/planted.ts:1: cloudflare",
      "provider import: packages/app/src/login/login.ts:1: cloudflare",
      "provider import: packages/app/src/login/return-path.ts:1: cloudflare",
      "provider import: packages/app/src/login/session.ts:1: cloudflare",
      "provider import: packages/app/src/sites/planted.ts:1: cloudflare",
      "provider import: packages/app/tests/limits/planted.test.ts:1: cloudflare",
      "provider import: packages/app/tests/login/return-path.test.ts:1: cloudflare",
      "provider import: packages/app/tests/login/session.test.ts:1: cloudflare",
      "provider import: packages/app/tests/sites/planted.ts:1: cloudflare",
      "provider import: packages/cli/scripts/planted.mts:1: cloudflare",
      "provider import: packages/core/src/storage/planted.ts:1: cloudflare",
      "provider import: packages/core/tests/planted.test.ts:1: cloudflare",
    ];

    expect(violations(tree.path)).toEqual(everyPlace);
    expect(violations(tree.path, ["packages/cli/scripts/planted.mts: cloudflare", "packages/cli/src/gone.ts: wrangler"])).toEqual([
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
      "const kinds = { r2: 1, d1Database: 2 };",
      "// Rules from https://developers.cloudflare.com/cache/ apply to any shared cache.",
      "const sizes = { rcf: 1, cfg: 2 };",
    ].join("\n");
    using tree = planted({
      "packages/app/package.json": '{ "name": "@poplin/app", "dependencies": { "cloudflare": "7.3.0" } }',
      "packages/worker/package.json": '{ "name": "@poplin/worker", "devDependencies": { "wrangler": "4.0.0" } }',
      "packages/worker/src/r2.ts": providerCode,
      "packages/app/src/cloudflare/client.ts": providerCode,
      "packages/app/src/login/access-token.ts": providerCode,
      "packages/app/src/login/keys.ts": providerCode,
      "packages/cli/node_modules/wrangler/index.js": providerCode,
      "packages/cli/dist/bin.mjs": providerCode,
      "packages/cli/README.md": providerCode,
      "packages/cli/tsconfig.json": '{ "compilerOptions": { "types": ["bun"] } }',
      "packages/core/src/storage/current.ts": portableCode,
    });

    expect(violations(tree.path)).toEqual([]);
  });
});
