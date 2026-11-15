// The demo in real browsers: Playwright builds it, serves it as a static host does, and walks it as a visitor would.
//
//   bun run test:browser                      every engine; each needs its browser: `bunx playwright install`
//   bun run test:browser --project chromium   one engine
//
// CI walks every engine on Linux, one job each: the `demo` job of `.github/workflows/checks.yml`.
//
// A failed test leaves its trace and a screenshot under `.cache/walk/`: `bunx playwright show-trace <trace.zip>` opens one.

import { defineConfig } from "@playwright/test";

/** The port the walk's own host listens on, beside a demo or a preview a person runs. */
const PORT = 4430;

/** Where the host serves the demo: under a folder, where the demo's own base path shows. */
const DEMO = `http://127.0.0.1:${PORT}/poplin/demo/`;

/** How long one test may take, in milliseconds: each begins with a first load of the demo, which alone may take half of it on a busy machine. */
const TEST_MS = 60_000;

/** The tests that need an engine a test can stop a worker in. */
const CHROMIUM_ONLY = "**/stopped-worker.walk.ts";

export default defineConfig({
  testDir: "walk",
  testMatch: "*.walk.ts",
  outputDir: ".cache/walk",
  fullyParallel: true,
  timeout: TEST_MS,
  forbidOnly: process.env.CI !== undefined,
  reporter: process.env.CI === undefined ? "list" : [["list"], ["github"]],
  use: { baseURL: DEMO, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" }, testIgnore: CHROMIUM_ONLY },
    { name: "webkit", use: { browserName: "webkit" }, testIgnore: CHROMIUM_ONLY },
  ],
  webServer: {
    command: `bun scripts/demo.ts --port ${PORT}`,
    url: DEMO,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
