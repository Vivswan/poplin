// The published build: one ESM file and one declaration file per entry, with core's modules bundled in.

import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/poplin.ts", "src/core.ts", "src/bin.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  dts: true,
  clean: true,
  // Fails the build when the manifest names a file the tarball would not carry.
  publint: { strict: true },
  // npm packs a license file from the package folder alone, and the repository keeps its one copy at the root.
  copy: [{ from: "../../LICENSE.md", to: "." }],
});
