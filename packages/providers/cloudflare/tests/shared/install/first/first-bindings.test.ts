// The first value of each binding a release keeps by name, against the repository's own Worker configuration.
// Without this a release could gain a bound thing that no first upload states: every new install of it would start a Worker that lacks the binding.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { bundleManifest, MAP_FILE, MODULE_FILE } from "../../../../src/shared/release/deploy/bundle-manifest";
import { firstBindings } from "../../../../src/shared/install/first/first-bindings";

/** The repository's own Worker configuration. */
const CONFIG: unknown = Bun.JSONC.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "..", "..", "wrangler.jsonc"), "utf8"));

/** What an install made before its first upload. */
const MADE = { script: "poplin", bucket: "poplin-sites", databaseId: "database-1" };

/** The names of the bindings the manifest of this repository's Worker keeps by name. */
async function keptNames(): Promise<string[]> {
  const files = { [MODULE_FILE]: new Uint8Array(1), [MAP_FILE]: new Uint8Array(1) };
  const manifest = JSON.parse(await bundleManifest({ version: "0.3.0", schema: OWN_SCHEMA, config: CONFIG, files })) as { deploy: { bindings: { name: string; kind: string }[] } };

  return manifest.deploy.bindings.flatMap((binding) => (binding.kind === "kept" ? [binding.name] : []));
}

// Drift: a binding added to the Worker's configuration is `kept` in every release's manifest from then on. With no first value here, no new install of that release could be made.
test("every binding this repository's Worker keeps by name has a first value: the bucket, the database by its id, the Workflow named after the Worker, and the Worker's own name", async () => {
  expect(firstBindings(await keptNames())?.(MADE)).toEqual([
    { type: "r2_bucket", bucket_name: "poplin-sites", name: "SITES" },
    { type: "d1", id: "database-1", name: "DB" },
    { type: "workflow", workflow_name: "poplin-jobs", class_name: "PoplinJobs", name: "JOBS" },
    { type: "plain_text", text: "poplin", name: "WORKER_NAME" },
  ]);
});

// Drift: a release built after this code may keep a binding this code cannot make. Stating the others alone would upload a Worker that starts without it.
test("a release that keeps a binding with no first value gets no writer at all, and a name of an object's own members is no binding", () => {
  expect([firstBindings(["SITES", "QUEUE"]), firstBindings(["toString"]), firstBindings([])?.(MADE)]).toEqual([undefined, undefined, []]);
});
