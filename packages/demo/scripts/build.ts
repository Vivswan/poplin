// Build the demo as static files: `bun run demo:build` writes `packages/demo/dist/`, which any static host serves.
//
//   index.html      the first page: it registers the worker, then loads the dashboard through it
//   sw.js           the worker: the demo, the product's own code, and the sample sites, minified
//   sql-wasm.wasm   SQLite
//   404.html        sends an address inside the demo through the first page, on a host that answers a missing path with it
//   assets/         the dashboard's client: its scripts, its stylesheet, and its fonts, which the worker reads from the host as a browser asks for each
//
//   sites.json      no build writes it: a host that also holds the sample sites as real ones puts the address of each here, and the dashboard's links then lead to them
//
//   bun scripts/build.ts --out <folder>   another folder

import { mkdtempDisposableSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import manifest from "../../cli/package.json" with { type: "json" };
import { buildClient, readClient } from "../../dashboard/scripts/client-build";
import { notFoundPage } from "./deep-links";
import { readSamples } from "./samples";

/** The folder of the browser host's sources. */
const BROWSER = join(import.meta.dir, "..", "src", "browser");

/** The folder a build without `--out` writes. */
export const DIST = join(import.meta.dir, "..", "dist");

/** SQLite's WebAssembly file, of the build of sql.js a browser bundle takes. */
const WASM = Bun.fileURLToPath(import.meta.resolve("sql.js/dist/sql-wasm-browser.wasm"));

/** The characters of a build's tag. */
const TAG_LENGTH = 12;

/** The folder of the built demo that holds the dashboard's client. The worker reads the same name. */
const CLIENT_FOLDER = "assets";

/** Where a build goes. */
interface Target {
  /** The folder to write; whatever it held is removed first. */
  readonly out: string;

  /** A folder that holds a build of the dashboard's client; left out, the client is built anew into a folder that is removed afterwards. */
  readonly client?: string;
}

/** What the worker's bundle is given in place of its names. */
interface Defined {
  /** Every sample site, packed. */
  readonly samples: string;

  /** The client's files, as JSON: the names of its script and stylesheet, and of every file. */
  readonly client: string;

  /** The build's tag. */
  readonly tag: string;
}

/** One written file and what it weighs. */
interface Built {
  readonly name: string;
  readonly bytes: number;
  readonly gzipped: number;
}

/** Every sample site as the worker unpacks it: its entry page's own title, `null` for none, and each file as its path, its media type, and its bytes in base64. */
async function packedSamples(): Promise<string> {
  const packed = Object.entries(await readSamples()).map(([name, { title, files }]) => [
    name,
    [title ?? null, files.map(({ path, contentType, bytes }) => [path, contentType, Buffer.from(bytes).toString("base64")])],
  ]);

  return JSON.stringify(Object.fromEntries(packed));
}

/** Bundle the worker with a tag in place of `BUILD`. */
async function bundle(defined: Defined): Promise<string> {
  const built = await Bun.build({
    entrypoints: [join(BROWSER, "worker.ts")],
    target: "browser",
    format: "iife",
    minify: true,
    define: { BUILD: JSON.stringify(defined.tag), CLIENT: defined.client, PACKED_SAMPLES: defined.samples, VERSION: JSON.stringify(manifest.version) },
  });
  const [script] = built.outputs;
  if (!built.success || script === undefined) throw new AggregateError(built.logs, "the demo's worker did not bundle");

  return script.text();
}

/**
 * Build the demo into a folder.
 *
 * @returns what was written into the folder, in the order a browser loads it. The same sources give the same bytes, so a host that deploys them again starts no visitor over
 * @throws {Error} the worker did not bundle, or a sample could not be read
 */
export async function buildDemo(target: Target): Promise<readonly Built[]> {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "poplin-client-"));
  if (target.client === undefined) await buildClient(scratch.path);

  const folder = target.client ?? scratch.path;
  const client = await readClient(folder);
  const samples = await packedSamples();
  const wasm = new Uint8Array(await Bun.file(WASM).arrayBuffer());

  // The tag names the worker's own content and SQLite's file: a build of other content gets another cache and drops what an older one saved.
  // The worker names the client's script and stylesheet by the hash of each, so another client is another tag too.
  const untagged = await bundle({ samples, client: JSON.stringify(client), tag: "" });
  const tag = new Bun.CryptoHasher("sha256").update(untagged).update(wasm).digest("hex").slice(0, TAG_LENGTH);
  const files: Record<string, string | Uint8Array> = {
    "index.html": await Bun.file(join(BROWSER, "index.html")).text(),
    "sw.js": await bundle({ samples, client: JSON.stringify(client), tag }),
    "sql-wasm.wasm": wasm,
    "404.html": notFoundPage("/"),
  };
  for (const name of client.names) files[`${CLIENT_FOLDER}/${name}`] = new Uint8Array(await Bun.file(join(folder, name)).arrayBuffer());

  await rm(target.out, { recursive: true, force: true });
  await Promise.all(Object.keys(files).map((name) => mkdir(dirname(join(target.out, name)), { recursive: true })));
  await Promise.all(Object.entries(files).map(([name, content]) => Bun.write(join(target.out, name), content)));

  return Object.entries(files).map(([name, content]) => {
    const bytes = Buffer.from(content);

    return { name, bytes: bytes.length, gzipped: gzipSync(bytes, { level: 9 }).length };
  });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } }, strict: true });
  const out = values.out ?? DIST;
  const built = await buildDemo({ out });
  const total = built.reduce((sum, file) => sum + file.gzipped, 0);

  console.log(`the demo, as static files in ${out}`);
  for (const file of built) console.log(`  ${file.name.padEnd(14)} ${String(file.bytes).padStart(8)} bytes ${String(file.gzipped).padStart(8)} gzipped`);
  console.log(`  ${"all of it".padEnd(14)} ${" ".repeat(14)} ${String(total).padStart(8)} gzipped`);
}
