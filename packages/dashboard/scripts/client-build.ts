// The dashboard's client as a host takes it: built into a folder of the caller's, and read back as the names of its files.
//
//   packages/dashboard  --its own build-->  the script the page loads, one script more for each screen, the stylesheet, and the fonts, each under a name that holds a hash of its content
//   .vite/manifest.json                     which of them the page loads

import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { Manifest } from "vite";

/** The folder of the dashboard's client. */
export const CLIENT = join(import.meta.dir, "..");

/** The manifest the client's build writes, from its folder, and the two entries of it that the page loads. */
const [MANIFEST, SCRIPT, STYLE] = [join(".vite", "manifest.json"), "src/main.tsx", "style.css"];

/** A built client: the names of the two files the page loads, and of every file. */
interface BuiltClient {
  readonly entry: { readonly script: string; readonly style: string };
  readonly names: readonly string[];
}

/**
 * Build the client into a folder, which holds nothing else afterwards.
 *
 * @throws {Error} the client did not build, or its build was stopped before it ended
 */
export async function buildClient(into: string): Promise<void> {
  // The build is the one an owner or a visitor gets, whatever the caller runs as: another environment would build the client's libraries with their checks for developers.
  const env = { ...process.env, NODE_ENV: "production" };
  const built = Bun.spawn([process.execPath, "run", "build", "--outDir", into, "--emptyOutDir"], { cwd: CLIENT, env, stdio: ["ignore", "ignore", "inherit"] });
  if ((await built.exited) === 0) return;
  throw new Error(built.signalCode === null ? "the dashboard's client did not build" : `the build of the dashboard's client was stopped by ${built.signalCode} before it ended`);
}

/**
 * Read which files a build of the client wrote.
 *
 * @param folder - the folder a build wrote into
 * @returns the names in their own order, so the same client reads the same
 * @throws {Error} the folder holds no manifest, or the manifest names no script or no stylesheet
 */
export async function readClient(folder: string): Promise<BuiltClient> {
  const manifest: Partial<Manifest> =await Bun.file(join(folder, MANIFEST)).json();
  const [script, style] = [manifest[SCRIPT]?.file, manifest[STYLE]?.file];
  if (script === undefined || style === undefined) throw new Error("the manifest of the client's build names no script, or no stylesheet");

  const names = readdirSync(folder, { withFileTypes: true }).flatMap((found) => (found.isFile() ? [found.name] : []));

  return { entry: { script, style }, names: names.sort() };
}
