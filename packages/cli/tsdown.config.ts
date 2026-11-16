// The published build: one ESM file per entry, with core's modules bundled in. The two library entries get a declaration file each; the command has none, since nothing imports it.
// Each provider's package gives the command one more file, `dist/providers/<its folder>.mjs`, which the command loads when a person installs at that provider. No other file of the build holds a provider's code.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "tsdown";

/** What every entry is built as. */
const SHARED = { format: "esm", platform: "node", target: "node24", clean: true } as const;

/** The folder that holds every provider's package. */
const PROVIDERS = join(import.meta.dirname, "..", "providers");

/** The file of a provider's package that the command works through, from the package's folder. */
const INSTALLER = join("src", "shared", "install", "first", "installer.ts");

/** The command's own minifying. Names are kept as written, so a stack trace still names its functions. */
const MINIFIED = { compress: true, mangle: false, codegen: { removeWhitespace: true } } as const;

/** One entry per provider: the built file's name, under `providers/`, to the source it is built from. */
function providerEntries(): Record<string, string> {
  const folders = readdirSync(PROVIDERS).filter((folder) => existsSync(join(PROVIDERS, folder, INSTALLER)));

  return Object.fromEntries(folders.map((folder) => [`providers/${folder}`, join(PROVIDERS, folder, INSTALLER)]));
}

export default defineConfig([
  {
    ...SHARED,
    entry: ["src/poplin.ts", "src/core.ts"],
    dts: true,
    // npm packs a license file from the package folder alone, and the repository keeps its one copy at the root.
    copy: [{ from: "../../LICENSE.md", to: "." }],
  },
  {
    ...SHARED,
    entry: ["src/bin.ts"],
    dts: false,
    // The command carries the MCP SDK.
    minify: MINIFIED,
    // Fails the build when the manifest names a file the tarball would not carry.
    publint: { strict: true },
  },
  {
    ...SHARED,
    entry: providerEntries(),
    dts: false,
    // A provider's file carries the provider's own SDK, which no other file of the build does.
    minify: MINIFIED,
  },
]);
