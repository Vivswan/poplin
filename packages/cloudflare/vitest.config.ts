// Runs the tests inside workerd, with the bindings of the repository's wrangler.jsonc simulated locally and the variables of an install that is set up.

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { EXAMPLE_BINDINGS } from "./tests/worker/support/example-bindings";
import { RuntimeLog } from "./tests/worker/support/runtime-log";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "../../wrangler.jsonc" }, miniflare: { bindings: EXAMPLE_BINDINGS } })],

  // Core's contract suite takes its test functions from bun; the two runners share their shape, so the same cases run here.
  resolve: { alias: { "bun:test": "vitest" } },

  test: {
    include: ["tests/{worker,storage,database,limits}/**/*.test.ts"],
    testTimeout: 30_000,
    reporters: ["default", new RuntimeLog()],
    // The pool sends a file's cached imports as one message, and the Cloudflare SDK takes that past workerd's 32 MiB limit.
    fsModuleCache: false,
  },
});
