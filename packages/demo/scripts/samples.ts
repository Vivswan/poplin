// The sample sites of the demo, read from `demo/samples` as a publish would read them.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { readFiles } from "../../cli/src/files/read";
import type { Samples } from "../src/preview/seed";

/** The folder that holds one folder per sample site. */
const SAMPLES = join(import.meta.dir, "..", "..", "..", "demo", "samples");

/**
 * Read every sample site whole.
 *
 * @returns the files of each folder under `demo/samples`, by the folder's name, with the content type a publish gives each
 * @throws {Error} a sample cannot be read, or holds a file a publish refuses
 */
export async function readSamples(): Promise<Samples> {
  const folders = (await readdir(SAMPLES, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  const read = folders.map(async (name) => {
    const listing = await readFiles(join(SAMPLES, name));
    if (!listing.ok) throw new Error(`the sample ${name} cannot be read: ${listing.reason}`);

    const files = listing.files.map(async ({ path, contentType, open }) => ({ path, contentType, bytes: new Uint8Array(await new Response(open()).arrayBuffer()) }));

    return [name, await Promise.all(files)] as const;
  });

  return Object.fromEntries(await Promise.all(read));
}
