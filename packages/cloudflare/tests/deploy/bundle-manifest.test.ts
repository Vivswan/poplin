// This pins the manifest a release ships beside its built Worker: a setting left out of it is one an install that takes the built files never gets.

import { describe, expect, test } from "bun:test";

import { releaseDigest } from "@poplin/core/src/records/release";
import { bundleFileProblem, readBundle } from "@poplin/core/src/records/release-bundle";

import { bundleManifest, MAP_FILE, MODULE_FILE } from "../../src/deploy/bundle-manifest";

/** Turns a text into the bytes of a file. */
const ENCODER = new TextEncoder();

/** A configuration with one of each thing the manifest states. */
const CONFIG = {
  $schema: "node_modules/wrangler/config-schema.json",
  name: "example",
  main: "src/worker.ts",
  compatibility_date: "2026-11-01",
  minify: true,
  upload_source_maps: true,
  build: { command: "bun run built-client" },
  keep_vars: true,
  triggers: { crons: ["*/15 * * * *"] },
  r2_buckets: [{ binding: "SITES", bucket_name: "example-sites" }],
  d1_databases: [{ binding: "DB", database_name: "example" }],
  ratelimits: [{ name: "MINUTE_LIMITS", namespace_id: "1001", simple: { limit: 1000, period: 60 } }],
  workflows: [{ name: "example-jobs", binding: "JOBS", class_name: "ExampleJobs" }],
  vars: { WORKER_NAME: "example" },
};

/** A built module and its map, as any bytes. */
const FILES = { [MODULE_FILE]: ENCODER.encode("export default {};\n//# sourceMappingURL=worker.js.map"), [MAP_FILE]: ENCODER.encode('{"version":3}') };

describe("bundleManifest", () => {
  // Drift: an install that takes the built files states these beside them. A binding written as the wrong kind would hand an install the release's bucket name, or drop its rate limit.
  test("the manifest states the version, the schema, each file's digest and size, and what an upload states beside the files: the account's own things as kept, the rate limit by value, and the Workflow by its class with no name", async () => {
    const manifest: unknown = JSON.parse(await bundleManifest({ version: "0.2.0", schema: 3, config: { ...CONFIG, compatibility_flags: ["nodejs_compat"], observability: { enabled: true } }, files: FILES }));

    expect(manifest).toEqual({
      version: "0.2.0",
      schema: 3,
      files: {
        "worker.js": { sha256: await releaseDigest(FILES[MODULE_FILE]), bytes: 53 },
        "worker.js.map": { sha256: await releaseDigest(FILES[MAP_FILE]), bytes: 13 },
      },
      deploy: {
        main_module: "worker.js",
        compatibility_date: "2026-11-01",
        compatibility_flags: ["nodejs_compat"],
        bindings: [
          { name: "SITES", kind: "kept" },
          { name: "DB", kind: "kept" },
          { name: "WORKER_NAME", kind: "kept" },
          { name: "MINUTE_LIMITS", kind: "stated", binding: { type: "ratelimit", namespace_id: "1001", simple: { limit: 1000, period: 60 } } },
          { name: "JOBS", kind: "stated", binding: { type: "workflow", class_name: "ExampleJobs" } },
        ],
        crons: ["*/15 * * * *"],
        observability: { enabled: true },
      },
    });
  });

  // Drift: the release run builds twice and refuses two manifests that differ; a manifest that held a moment or a path would fail every release.
  test("the same release gives the same text, which the portable reader takes, and which states the files it was made from", async () => {
    const built = { version: "0.2.0", schema: 3, config: CONFIG, files: FILES };
    const text = await bundleManifest(built);
    const read = readBundle(text);

    expect([await bundleManifest(built), read.ok && [read.bundle.version, read.bundle.schema, await bundleFileProblem(read.bundle, MODULE_FILE, FILES[MODULE_FILE]), await bundleFileProblem(read.bundle, MAP_FILE, FILES[MAP_FILE])]]).toEqual([
      text,
      ["0.2.0", 3, undefined, undefined],
    ]);
  });
});
