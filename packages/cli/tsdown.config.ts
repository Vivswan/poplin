// The published build: one ESM file per entry, with core's modules bundled in. The two library entries get a declaration file each; the command has none, since nothing imports it.

import { defineConfig } from "tsdown";

/** What every entry is built as. */
const SHARED = { format: "esm", platform: "node", target: "node24", clean: true } as const;

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
    // The command carries the MCP SDK. Names are kept as written, so a stack trace still names its functions.
    minify: { compress: true, mangle: false, codegen: { removeWhitespace: true } },
    // Fails the build when the manifest names a file the tarball would not carry.
    publint: { strict: true },
  },
]);
