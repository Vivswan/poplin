// Runs the tests inside workerd, with the bindings of wrangler.jsonc simulated locally.

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],

  // Core's contract suite takes its test functions from bun; the two runners share their shape, so the same cases run here.
  resolve: { alias: { "bun:test": "vitest" } },

  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000 },
});
