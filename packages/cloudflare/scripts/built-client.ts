// Write the dashboard's client into the Worker's sources as one module: `src/worker/built-client.js`, which no commit holds.
//
//   packages/dashboard  --its own build, into a folder made for this run-->  the script, the stylesheet, the fonts, and the build's manifest
//   the manifest        -->  the names of the script and the stylesheet, each of which holds a hash of its content
//   each file           -->  its media type, and its content as text, or as base64 when it is no text
//
// A Worker is deployed as one file, so the client's files ride inside it as values. wrangler runs this before it bundles the Worker, from whichever folder it is started in: `build.command` in wrangler.jsonc.

import { mkdtempDisposableSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The folder of the dashboard's client. */
const CLIENT = join(import.meta.dir, "..", "..", "dashboard");

/** The module this script writes. */
const MODULE = join(import.meta.dir, "..", "src", "worker", "built-client.js");

/** The manifest the client's build writes, from its folder, and the two entries of it that the page loads. */
const [MANIFEST, SCRIPT, STYLE] = [join(".vite", "manifest.json"), "src/main.tsx", "style.css"];

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
  // The build is the one an owner gets, whatever starts it: another environment would build the client's libraries with their checks for developers.
  const env = { ...process.env, NODE_ENV: "production" };
  const build = Bun.spawn([process.execPath, "run", "build", "--outDir", built.path, "--emptyOutDir"], { cwd: CLIENT, env, stdio: ["ignore", "ignore", "inherit"] });
  if ((await build.exited) !== 0) throw new Error("the dashboard's client did not build");

  const manifest: Readonly<Record<string, { readonly file: string } | undefined>> = await Bun.file(join(built.path, MANIFEST)).json();
  const entry = { script: manifest[SCRIPT]?.file, style: manifest[STYLE]?.file };
  if (entry.script === undefined || entry.style === undefined) throw new Error("the manifest of the client's build names no script, or no stylesheet");

  // In the order of their names, so the same client gives the same module.
  const names = readdirSync(built.path, { withFileTypes: true }).flatMap((found) => (found.isFile() ? [found.name] : []));
  const files = Object.fromEntries(await Promise.all(names.sort().map(async (name) => [name, await packed(built.path, name)] as const)));

  await Bun.write(MODULE, `// Written by scripts/built-client.ts from the dashboard's client, before the Worker is bundled. No commit holds it.\nexport const CLIENT = ${JSON.stringify({ entry, files })};\n`);
}

await writeModule();
