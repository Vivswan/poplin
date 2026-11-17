// The package smoke test: packs the package, installs the tarball with npm into an empty project, and runs it under plain Node.
//
// It holds what no workspace test can see: the installed package runs with nothing the workspace has, under node alone.
// It also holds how the package carries a provider: one built file per provider's package, loaded under node, within its size, and with none of its code in the package's other files.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

/** This package's folder. */
const PACKAGE_DIR = join(import.meta.dir, "..");

/** The package's name, and the command's. */
const NAME = "poplin";

/** The files npm's page and the license field point at. */
const CARRIED = ["LICENSE.md", "README.md"];

/** The manifest of the empty project the tarball is installed into. */
const PROJECT_MANIFEST = { name: "smoke-project", private: true, type: "module" };

/** What the command exits with when it is written wrong. */
const USAGE_STATUS = 2;

/** The files of the package that hold no provider's code. */
const MAIN_FILES = ["bin.mjs", "poplin.mjs", "core.mjs"];

/** The file of a provider's package that its built file is made from. */
const INSTALLER = join("src", "shared", "install", "first", "installer.ts");

/** The most bytes a provider's built file may have; Cloudflare's is about 520,400. It is loaded by the commands that take an account token alone, so no other command starts slower for it. */
const MOST_PROVIDER_BYTES = 560_000;

/** Run under node: a provider's built file loads, gives the provider it is named after, and none of its own words is in a main file. */
const PROVIDER_PROBE = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [file, id, ...mains] = process.argv.slice(2);
const { installer } = await import(file);

assert.equal(process.versions.bun, undefined, "the probe runs under node, not bun");
assert.equal(installer.id, id, "a provider's built file is named after the provider it gives");

const own = [installer.about, installer.usage, ...installer.options.map((option) => option.about)];
for (const main of mains) {
  const text = readFileSync(main, "utf8");
  for (const words of own) assert.equal(text.includes(words), false, main + " holds the provider's own words: " + words);
}
`;

/** Run under node: the two library entries load, and say the installed version. */
const PROBE = `
import assert from "node:assert/strict";
import { VERSION } from "poplin";
import { parseSiteName } from "poplin/core";

assert.equal(process.versions.bun, undefined, "the probe runs under node, not bun");
assert.equal(VERSION, process.argv[2]);
assert.deepEqual(parseSiteName("field-notes"), { ok: true, value: "field-notes" });
assert.deepEqual(parseSiteName("Field Notes"), { ok: false, refusal: "bad-character" });
`;

/** Run under node: the installed command serves a session and lists every tool. */
const MCP_PROBE = `
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { SITE_ACTIONS } from "poplin/core";

const [bin, config] = process.argv.slice(2);
const env = { ...process.env, POPLIN_CONFIG_DIR: config, POPLIN_SERVER: "", POPLIN_TOKEN: "" };
const server = spawn(process.execPath, [bin, "mcp"], { env, stdio: ["pipe", "pipe", "inherit"] });
const answers = createInterface({ input: server.stdout })[Symbol.asyncIterator]();

async function ask(id, method, params) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");
  const { value, done } = await answers.next();
  assert.equal(done, false, "the server closed stdout before it answered " + method);

  return JSON.parse(value);
}

const hello = await ask(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1.0.0" } });
assert.equal(hello.result.serverInfo.name, "poplin");
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");

const listed = await ask(2, "tools/list", {});
assert.deepEqual(listed.result.tools.map((tool) => tool.name), SITE_ACTIONS.map((action) => action.tool));

server.stdin.end();
const [code] = await once(server, "exit");
assert.equal(code, 0, "poplin mcp exits 0 once stdin closes");
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

  if (bare.status !== USAGE_STATUS || !bare.stderr.startsWith("Usage:")) {
    throw new Error(`${NAME} with no arguments exited ${bare.status} with ${JSON.stringify(bare.stderr)}, not ${USAGE_STATUS} with its usage`);
  }
}

/** Checks every provider's file of the installed package: one per provider's package and no other, each within its size, loaded under node, and its code in no main file. */
function assertProviders(project: string, installed: string): string[] {
  const packages = join(PACKAGE_DIR, "..", "providers");
  const providers = readdirSync(packages).filter((folder) => existsSync(join(packages, folder, INSTALLER)));
  const built = readdirSync(join(installed, "dist", "providers")).sort();
  const mains = MAIN_FILES.map((name) => join(installed, "dist", name));

  if (JSON.stringify(built) !== JSON.stringify(providers.map((folder) => `${folder}.mjs`).sort())) {
    throw new Error(`the installed package carries ${JSON.stringify(built)} as its providers, and the workspace has ${JSON.stringify(providers)}`);
  }

  writeFileSync(join(project, "provider-probe.mjs"), PROVIDER_PROBE);

  for (const name of built) {
    const file = join(installed, "dist", "providers", name);
    const id = basename(name, ".mjs");
    const { size } = statSync(file);

    if (size > MOST_PROVIDER_BYTES) throw new Error(`${name} has ${size} bytes, above the ${MOST_PROVIDER_BYTES} a provider's file may have`);

    run(project, "node", "provider-probe.mjs", pathToFileURL(file).href, id, ...mains);
  }

  return built;
}

function smoke(): void {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-smoke-"));
  const project = join(scratch.path, "project");
  const installed = install(project, pack(scratch.path));
  const { version }: { version: string } = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));

  // npm's page shows the readme. The manifest's license field points at the license, which the build copies in from the repository root.
  const lacking = CARRIED.filter((name) => !existsSync(join(installed, name)));

  if (lacking.length > 0) {
    throw new Error(`the installed package lacks ${lacking.join(" and ")}`);
  }

  writeFileSync(join(project, "probe.mjs"), PROBE);
  run(project, "node", "probe.mjs", version);

  assertBin(project, version);

  // The installed command serves a session as `poplin mcp` on a machine with no login. A bundle that lost a part of the MCP SDK fails here.
  writeFileSync(join(project, "mcp-probe.mjs"), MCP_PROBE);
  run(project, "node", "mcp-probe.mjs", join(installed, "dist", "bin.mjs"), join(scratch.path, "config"));

  // The installed package carries each provider as one file of its own, which runs under node with nothing of the workspace.
  const providers = assertProviders(project, installed);

  console.log(`${NAME}@${version} installs, runs, serves its MCP tools, and loads ${providers.join(", ")} under node ${run(project, "node", "--version")}`);
}

smoke();
