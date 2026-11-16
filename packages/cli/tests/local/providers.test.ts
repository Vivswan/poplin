import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadProviders } from "../../src/local/providers";

/** The scratch folders the tests made, removed after each test. */
const SCRATCH: string[] = [];

/** The command's package, which the build is run in. */
const PACKAGE = join(import.meta.dir, "..", "..");

/** The folder that holds every provider's package. */
const PROVIDER_PACKAGES = join(PACKAGE, "..", "providers");

/** The file of a provider's package that the build makes its file from, from the package's folder. */
const ENTRY = join("src", "shared", "install", "first", "installer.ts");

/** How long the build and the built command may take together, in milliseconds: a minute. */
const BUILD_TIMEOUT_MS = 60_000;

/** A provider's file as it is built: one module that exports `installer` under the given id. */
function providerFile(id: string): string {
  const words = `id: ${JSON.stringify(id)}, name: "Host", about: "a host", usage: "", options: [], tokenHelp: []`;
  const calls = "token: () => undefined, read: () => ({ ok: false, why: 'open', open: [] }), facts: () => ({}), find: async () => ({}), install: async () => ({})";

  return `export const installer = { ${words}, ${calls} };\n`;
}

/** Make a folder of files that the test's end removes; answers its path. */
function folderOf(files: Readonly<Record<string, string>>): string {
  const folder = mkdtempSync(join(tmpdir(), "poplin-providers-"));
  SCRATCH.push(folder);

  for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);

  return folder;
}

afterEach(() => {
  for (const folder of SCRATCH.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** Run a program to its end; fails the test when it does not exit with 0. Answers what it printed. */
function ran(command: readonly string[], cwd: string): string {
  const done = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, POPLIN_INSTALL_TOKEN: undefined } });
  if (done.exitCode !== 0) throw new Error(`${command.join(" ")} exited ${done.exitCode}: ${done.stderr.toString()}`);

  return done.stdout.toString();
}

describe("the built package", () => {
  test(
    "every provider's package is built into one file that loads as a provider under its folder's name, and the built command lists it: without this the command and a provider's file drift apart and install finds no provider",
    async () => {
      const out = folderOf({});
      const folders = readdirSync(PROVIDER_PACKAGES)
        .filter((folder) => existsSync(join(PROVIDER_PACKAGES, folder, ENTRY)))
        .sort();

      // The manifest's check reads the package's own `dist`, which a build into a scratch folder does not fill.
      ran(["bun", "x", "tsdown", "--out-dir", out, "--no-publint"], PACKAGE);
      const providers = await loadProviders(join(out, "providers"));
      // The built command runs under the runtime of the tests: a runner's own `node` may be older than the one the build is made for.
      const listed: { readonly providers: readonly { readonly id: string }[] } = JSON.parse(ran([process.execPath, join(out, "bin.mjs"), "install", "--json"], out));

      expect(folders.length).toBeGreaterThan(0);
      expect(providers.map((one) => one.id)).toEqual(folders);
      expect(listed.providers.map((one) => one.id)).toEqual(folders);
      expect(providers.filter((one) => one.options.length === 0 || one.tokenHelp.length === 0 || one.usage === "")).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );
});

describe("loadProviders", () => {
  test("every built file of the folder is one provider, in the order of the names, and other files are left alone: without this the command would have to name its providers", async () => {
    const folder = folderOf({ "second-host.mjs": providerFile("second-host"), "first-host.mjs": providerFile("first-host"), "first-host.mjs.map": "{}", "notes.txt": "no provider" });
    const providers = await loadProviders(folder);

    expect(providers.map((one) => one.id)).toEqual(["first-host", "second-host"]);
  });

  test("a folder that is not there holds no provider, and one that cannot be read as a folder is an error: without this a damaged package reads as a build with no provider", async () => {
    const folder = folderOf({ "a-file": "no folder" });

    expect(await loadProviders(join(folder, "gone"))).toEqual([]);
    expect(loadProviders(join(folder, "a-file"))).rejects.toThrow("ENOTDIR");
  });

  test.each([
    ["exports no installer", "export const other = 1;\n"],
    ["exports an installer under another id", providerFile("another")],
    ["exports an installer that lacks a member", "export const installer = { id: 'broken-host', name: 'Host' };\n"],
  ])("a file that %s is refused by its name: without this a damaged package fails somewhere inside a run", async (_name, text) => {
    const folder = folderOf({ "broken-host.mjs": text });

    expect(loadProviders(folder)).rejects.toThrow("broken-host.mjs is no provider of this poplin");
  });
});
