// Write the dashboard's client into the Worker's sources as one module: `src/worker/built-client.js`, which no commit holds.
//
//   packages/dashboard  --its own build, into a folder made for this run-->  the script, the stylesheet, the fonts, and the build's manifest
//   the manifest        -->  the names of the script and the stylesheet, each of which holds a hash of its content
//   each file           -->  its media type, and its content as text, or as base64 when it is no text
//
// A Worker is deployed as one file, so the client's files ride inside it as values. wrangler runs this before it bundles the Worker, from whichever folder it is started in: `build.command` in wrangler.jsonc.

import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildClient, readClient } from "../../dashboard/scripts/client-build";

/** The module this script writes. */
const MODULE = join(import.meta.dir, "..", "src", "worker", "built-client.js");

/** One file as the module holds it. */
type Packed = { readonly type: string; readonly text: string } | { readonly type: string; readonly base64: string };

async function packed(folder: string, name: string): Promise<Packed> {
  const file = Bun.file(join(folder, name));
  const { type } = file;

  return type.startsWith("text/") ? { type, text: await file.text() } : { type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") };
}

/**
 * Build the client and write the module.
 *
 * @throws {Error} the client did not build, or its manifest names no script or no stylesheet
 */
async function writeModule(): Promise<void> {
  using built = mkdtempDisposableSync(join(tmpdir(), "poplin-client-"));
  await buildClient(built.path);

  const { entry, names } = await readClient(built.path);
  const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await packed(built.path, name)] as const)));

  await Bun.write(MODULE, `// Written by scripts/built-client.ts from the dashboard's client, before the Worker is bundled. No commit holds it.\nexport const CLIENT = ${JSON.stringify({ entry, files })};\n`);
}

await writeModule();
