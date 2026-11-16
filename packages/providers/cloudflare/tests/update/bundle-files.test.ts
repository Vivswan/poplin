// The built files of a release as an install reads them from the release's page.
// Without these a setting added to wrangler.jsonc could ship in a manifest no install can read, and a release with a large map, or none, could not be taken at all.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { releaseDigest } from "@poplin/core/src/records/release";
import { bundleManifest, MAP_FILE, MODULE_FILE } from "../../src/deploy/bundle-manifest";
import { bundleAddress, MANIFEST_FILE } from "../../src/deploy/release-source";
import { checkedBundle } from "../../src/update/bundle-files";

/** Turns a text into the bytes of a file. */
const ENCODER = new TextEncoder();

/** A built module and its map, as any bytes. */
const [MODULE, MAP] = [ENCODER.encode("export default {};"), ENCODER.encode('{"version":3}')];

/** The repository's own configuration, which every release's manifest is written from. */
const CONFIG: unknown = Bun.JSONC.parse(await Bun.file(join(import.meta.dir, "..", "..", "..", "..", "..", "wrangler.jsonc")).text());

/** A release's page that holds the given files, and records what it was asked for. */
function pageOf(files: Readonly<Record<string, Uint8Array<ArrayBuffer>>>, asked: string[]): { readonly fetch: (url: string) => Promise<Response> } {
  return {
    fetch: async (url) => {
      asked.push(url);
      const file = Object.entries(files).find(([name]) => bundleAddress("0.3.0", name) === url)?.[1];

      return file === undefined ? new Response("no such file", { status: 404 }) : new Response(file);
    },
  };
}

/** Fetch and check release 0.3.0 from a page that holds a manifest's text and the two built files. */
async function checked(manifest: string): Promise<{ readonly answer: Awaited<ReturnType<typeof checkedBundle>>; readonly asked: string[] }> {
  const asked: string[] = [];
  const page = pageOf({ [MANIFEST_FILE]: ENCODER.encode(manifest), [MODULE_FILE]: MODULE, [MAP_FILE]: MAP }, asked);
  const answer = await checkedBundle(page, "0.3.0", { source: "0".repeat(64), bundle: await releaseDigest(ENCODER.encode(manifest)), schema: 2 });

  return { answer, asked: asked.map((url) => url.slice(url.lastIndexOf("/") + 1)) };
}

describe("checkedBundle", () => {
  // Drift: the manifest is written by one file and read by another. A setting the writer learns and the reader refuses would ship a release no install can take by itself.
  test("the manifest of the repository's own wrangler.jsonc is read whole: every binding, the cron list, and observability", async () => {
    const manifest = await bundleManifest({ version: "0.3.0", schema: 2, config: CONFIG, files: { [MODULE_FILE]: MODULE, [MAP_FILE]: MAP } });
    const { answer, asked } = await checked(manifest);

    expect<unknown>([answer, asked]).toEqual([
      { ok: true, bundle: { version: "0.3.0", deploy: (JSON.parse(manifest) as { deploy: unknown }).deploy, module: MODULE, map: MAP } },
      ["poplin-0.3.0-worker.json", "poplin-0.3.0-worker.js", "poplin-0.3.0-worker.js.map"],
    ]);
  });

  /** A manifest as a release run would write it, with its statement of the files replaced. */
  async function stating(files: (stated: Record<string, { sha256: string; bytes: number }>) => object, deploy: (stated: object) => unknown = (stated) => stated): Promise<string> {
    const written = JSON.parse(await bundleManifest({ version: "0.3.0", schema: 2, config: CONFIG, files: { [MODULE_FILE]: MODULE, [MAP_FILE]: MAP } })) as { files: Record<string, { sha256: string; bytes: number }>; deploy: object };

    return JSON.stringify({ ...written, files: files(written.files), deploy: deploy(written.deploy) });
  }

  // Drift: the map is for the log alone. A release whose map is too large to carry, or that has none, is still a release the install can take.
  test.each([
    { name: "a map above 16 MiB is not fetched, and the release is taken without it", files: (stated: Record<string, { sha256: string; bytes: number }>) => ({ ...stated, [MAP_FILE]: { ...stated[MAP_FILE], bytes: 16_777_217 } }) },
    { name: "a release that names no map is taken without one", files: (stated: Record<string, { sha256: string; bytes: number }>) => ({ [MODULE_FILE]: stated[MODULE_FILE] }) },
  ])("$name", async ({ files }) => {
    const { answer, asked } = await checked(await stating(files));

    expect<unknown>([answer.ok && [answer.bundle.module, answer.bundle.map], asked]).toEqual([[MODULE, undefined], ["poplin-0.3.0-worker.json", "poplin-0.3.0-worker.js"]]);
  });

  // Drift: a manifest whose digest matched is the project's own word. One this code cannot write an upload from must stop the update, never be guessed at.
  test.each([
    { name: "names no module", files: (stated: Record<string, unknown>) => ({ [MAP_FILE]: stated[MAP_FILE] }), deploy: (stated: object) => stated, why: "needs_hand", fetched: 1 },
    { name: "has no part for the upload", files: (stated: object) => stated, deploy: () => undefined, why: "needs_hand", fetched: 1 },
    { name: "names another main module", files: (stated: object) => stated, deploy: (stated: object) => ({ ...stated, main_module: "other.js" }), why: "needs_hand", fetched: 1 },
    { name: "states a binding of a kind this code does not know", files: (stated: object) => stated, deploy: (stated: object) => ({ ...stated, bindings: [{ name: "QUEUE", kind: "made" }] }), why: "needs_hand", fetched: 1 },
  ])("a manifest that $name is refused: $why", async ({ files, deploy, why, fetched }) => {
    const { answer, asked } = await checked(await stating(files, deploy));

    expect<unknown>([answer, asked.length]).toEqual([{ ok: false, why }, fetched]);
  });
});
