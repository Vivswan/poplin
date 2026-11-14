// The package smoke test: packs the package, installs the tarball with npm into an empty project, and runs it under plain Node.
//
// It holds what no workspace test can see: the installed package runs with nothing the workspace has, under node alone.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_DIR = join(import.meta.dir, "..");
const NAME = "poplin";
const LICENSE = "LICENSE.md";
const PROJECT_MANIFEST = { name: "smoke-project", private: true, type: "module" };
const USAGE_STATUS = 2;

// Run by node from the project folder; it throws on the first check that fails.
const PROBE = `
import assert from "node:assert/strict";
import { VERSION } from "poplin";
import { parseSiteName } from "poplin/core";

assert.equal(process.versions.bun, undefined, "the probe runs under node, not bun");
assert.equal(VERSION, process.argv[2]);
assert.deepEqual(parseSiteName("field-notes", new Set()), { ok: true, value: "field-notes" });
assert.deepEqual(parseSiteName("Field Notes", new Set()), { ok: false, refusal: "bad-character" });
`;

function run(cwd: string, command: string, ...args: string[]): string {
  return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

/** Packs the package into `into`, an empty folder; npm runs the build first, as it does on a publish. */
function pack(into: string): string {
  run(PACKAGE_DIR, "npm", "pack", "--pack-destination", into);
  const [tarball] = readdirSync(into).filter((name) => name.endsWith(".tgz"));

  if (tarball === undefined) {
    throw new Error("npm pack left no tarball");
  }

  return join(into, tarball);
}

function install(project: string, tarball: string): string {
  mkdirSync(project);
  writeFileSync(join(project, "package.json"), JSON.stringify(PROJECT_MANIFEST));
  run(project, "npm", "install", "--no-audit", "--no-fund", "--ignore-scripts", tarball);

  return join(project, "node_modules", NAME);
}

function assertBin(project: string, version: string): void {
  const bin = join(project, "node_modules", ".bin", NAME);
  const printed = run(project, bin, "--version");

  if (printed !== version) {
    throw new Error(`${NAME} --version printed ${JSON.stringify(printed)}, and the installed package.json says ${version}`);
  }

  const bare = spawnSync(bin, [], { cwd: project, encoding: "utf8" });

  if (bare.status !== USAGE_STATUS || !bare.stderr.startsWith("usage:")) {
    throw new Error(`${NAME} with no arguments exited ${bare.status} with ${JSON.stringify(bare.stderr)}, not ${USAGE_STATUS} with its usage`);
  }
}

function smoke(): void {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-smoke-"));
  const project = join(scratch.path, "project");
  const installed = install(project, pack(scratch.path));
  const { version }: { version: string } = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));

  // The build copies the license in from the repository root, and the manifest's license field points at it.
  if (!existsSync(join(installed, LICENSE))) {
    throw new Error(`the installed package lacks ${LICENSE}`);
  }

  writeFileSync(join(project, "probe.mjs"), PROBE);
  run(project, "node", "probe.mjs", version);

  assertBin(project, version);

  console.log(`${NAME}@${version} installs and runs under node ${run(project, "node", "--version")}`);
}

smoke();
