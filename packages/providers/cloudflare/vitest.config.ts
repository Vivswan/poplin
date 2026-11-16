// Runs the tests inside workerd, with the bindings of the repository's wrangler.jsonc simulated locally and the variables of an install that is set up.

import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { EXAMPLE_BINDINGS } from "./tests/shared/worker/support/example-bindings";
import { BudgetReport } from "./tests/shared/worker/support/budget-report";
import { RuntimeLog } from "./tests/shared/worker/support/runtime-log";
import { LoadReport } from "./tests/load/support/load-report";

/** Whether this is the load run a person starts with `bun run load`: the full sizes, and the load's own tests alone. Any other run holds the load's small slice among the Worker's tests. */
const FULL_LOAD = process.env.POPLIN_LOAD === "full";

/** The Worker's tests, and the load's. */
const TESTS = { worker: "tests/shared/{worker,storage,database,limits,jobs}/**/*.test.ts", load: "tests/load/**/*.test.ts" } as const;

/** How long one test may take, in milliseconds: a scenario of the full load fills an install of thousands of sites at each of its sizes. */
const TEST_TIMEOUT_MS = { tests: 30_000, fullLoad: 1_800_000 } as const;

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "../../../wrangler.jsonc" }, miniflare: { bindings: EXAMPLE_BINDINGS } })],

  // Core's contract suite takes its test functions from bun; the two runners share their shape, so the same cases run here.
  resolve: { alias: { "bun:test": "vitest" } },

  test: {
    include: FULL_LOAD ? [TESTS.load] : [TESTS.worker, TESTS.load],
    testTimeout: FULL_LOAD ? TEST_TIMEOUT_MS.fullLoad : TEST_TIMEOUT_MS.tests,
    provide: { loadProfile: FULL_LOAD ? "full" : "slice" },
    reporters: ["default", new RuntimeLog(), new BudgetReport(), new LoadReport(FULL_LOAD ? "full" : "slice")],
    // The pool sends a file's cached imports as one message, and the Cloudflare SDK takes that past workerd's 32 MiB limit.
    fsModuleCache: false,
  },
});
