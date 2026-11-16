// Builds the Worker as a release ships it, into a folder: `bun run --cwd packages/cloudflare bundle <folder>`.
//
//   poplin-<version>-worker.js       the one module a deploy uploads, built by wrangler exactly as `bun run build` builds it
//   poplin-<version>-worker.js.map   its source map
//   poplin-<version>-worker.json     the manifest: the version, the schema, each file's digest and size, and what an upload states beside them
//
// The version is the tree's own, the schema the number of its migration steps, and the rest its wrangler.jsonc: nothing is typed by hand.

import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { OWN_SCHEMA } from "@poplin/core/src/database/open";

import { version } from "../../cli/package.json";
import { bundleManifest, MAP_FILE, MODULE_FILE } from "../src/deploy/bundle-manifest";
import { bundleAsset, MANIFEST_FILE } from "../src/deploy/release-source";

const PACKAGE = join(import.meta.dir, "..");

const CONFIG = join(PACKAGE, "..", "..", "wrangler.jsonc");

const BUILT = join(PACKAGE, "dist");

const [folder] = process.argv.slice(2);
if (folder === undefined) throw new Error("usage: bundle.ts <folder to write>");

const out = resolve(folder);
mkdirSync(out, { recursive: true });

// A module left by an earlier build is never taken for this one.
rmSync(BUILT, { recursive: true, force: true });

const code = await Bun.spawn(["bun", "run", "build"], { cwd: PACKAGE, stdin: "ignore", stdout: "inherit", stderr: "inherit" }).exited;
if (code !== 0) throw new Error(`the Worker did not build: bun run build ended with ${code}`);

const files = { [MODULE_FILE]: await Bun.file(join(BUILT, MODULE_FILE)).bytes(), [MAP_FILE]: await Bun.file(join(BUILT, MAP_FILE)).bytes() };
const manifest = await bundleManifest({ version, schema: OWN_SCHEMA, config: Bun.JSONC.parse(await Bun.file(CONFIG).text()), files });

await Bun.write(join(out, bundleAsset(version, MODULE_FILE)), files[MODULE_FILE]);
await Bun.write(join(out, bundleAsset(version, MAP_FILE)), files[MAP_FILE]);
await Bun.write(join(out, bundleAsset(version, MANIFEST_FILE)), manifest);

console.log(`poplin ${version}: built into ${out}, schema ${OWN_SCHEMA}`);
