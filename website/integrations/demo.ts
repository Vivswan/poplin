import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";

/** The script that builds the dashboard demo as static files; bun runs it, since it bundles with bun. */
const BUILD_SCRIPT = fileURLToPath(new URL("../../packages/demo/scripts/build.ts", import.meta.url));

/** The folder of the built site the demo goes into, which is also the first segment of its address. */
const FOLDER = "demo";

/**
 * Builds the dashboard demo into the built site at `demo/`, and puts the demo's deep-link script into the site's 404 page.
 * The demo runs inside the visitor's browser: a static host has no file for a page inside it, so the 404 page sends such an address through the demo's first page.
 */
export function demoIntegration(): AstroIntegration {
  let base = "/";
  return {
    name: "poplin-demo",
    hooks: {
      "astro:config:done": ({ config }) => {
        base = config.base.replace(/\/?$/, "/");
      },
      "astro:build:done": ({ dir }) => {
        const site = fileURLToPath(dir);
        const args = [BUILD_SCRIPT, "--out", join(site, FOLDER), "--not-found", join(site, "404.html"), "--at", `${base}${FOLDER}/`];
        const built = spawnSync("bun", args, { stdio: "inherit" });
        if (built.status !== 0) {
          throw new Error(`The dashboard demo did not build: bun ${args.join(" ")} ended with ${built.status ?? built.error?.message}.`);
        }
      },
    },
  };
}
