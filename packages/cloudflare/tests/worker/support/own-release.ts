// A release an install can take by itself, and the two things it is taken from: the project's website with the release's page, and Cloudflare's API of the install's own Worker. Written by hand for the tests.

import { OWN_SCHEMA } from "@poplin/core/src/database/open";
import { releaseDigest } from "@poplin/core/src/records/release";
import { bundleManifest, MAP_FILE, MODULE_FILE } from "../../../src/deploy/bundle-manifest";
import { bundleAsset, MANIFEST_FILE } from "../../../src/deploy/release-source";
import type { Outside } from "../../../src/worker/start";

/** The secret of an install that holds its key, in the form the reader takes and nothing like one Cloudflare makes. */
export const OWN_KEY = "kept-key-of-the-test";

/** Every binding of a set-up install's Worker, as Cloudflare's API lists them. */
const OWN_BINDINGS = ["SITES", "DB", "JOBS", "MINUTE_LIMITS", "WORKER_NAME", "ACCOUNT_ID", "ZONE", "ACCESS", "FIRST_SETTINGS", "KEPT_KEY"];

/** The built module of the release, as any text. */
const MODULE = "export default {};\n";

/** The configuration the release is built from, with one of each thing its manifest states. */
const CONFIG = {
  name: "poplin",
  main: "worker.ts",
  compatibility_date: "2026-11-01",
  minify: true,
  upload_source_maps: true,
  observability: { enabled: true },
  build: { command: "bun run built-client" },
  keep_vars: true,
  triggers: { crons: ["*/15 * * * *"] },
  r2_buckets: [{ binding: "SITES" }],
  d1_databases: [{ binding: "DB" }],
  ratelimits: [{ name: "MINUTE_LIMITS", namespace_id: "1001", simple: { limit: 1_000_000, period: 60 } }],
  workflows: [{ name: "poplin-jobs", binding: "JOBS", class_name: "PoplinJobs" }],
  vars: { WORKER_NAME: "poplin" },
};

/** One upload as the stand-in for the API read it: the bindings kept by name, the observability stated, the module's text, and whether a map came along. */
interface Uploaded {
  readonly kept: readonly string[];
  readonly observability: unknown;
  readonly module: string | null;
  readonly map: boolean;
}

/** A published release with what an install takes it from. */
interface OwnRelease {
  /** The website, which names the release as the newest, and the release's page. */
  readonly latest: Outside["latest"];

  /** Cloudflare's API of the install's own Worker, which takes the kept key alone. */
  readonly cloudflare: NonNullable<Outside["cloudflare"]>;

  /** Every upload the API took, in order. */
  readonly uploads: readonly Uploaded[];

  /** What one upload of the release reads as. */
  readonly upload: Uploaded;
}

function result(value: unknown): Response {
  return Response.json({ success: true, errors: [], messages: [], result: value });
}

/** Read one upload as workerd hands it over. */
async function uploadOf(request: Request): Promise<Uploaded> {
  const form = await request.formData();
  const metadata = JSON.parse(String(form.get("metadata"))) as { readonly bindings: readonly { readonly name: string; readonly type: string }[]; readonly observability: unknown };
  const module: unknown = form.get(MODULE_FILE);

  return {
    kept: metadata.bindings.filter((binding) => binding.type === "inherit").map((binding) => binding.name),
    observability: metadata.observability,
    module: module instanceof Blob ? await module.text() : null,
    map: form.has(MAP_FILE),
  };
}

/**
 * Publish one release of this install's own schema, for a test.
 *
 * @param version - its version, above the one the tests' Worker runs
 * @returns the website and the API to hand an instance, and what the API was uploaded
 */
export async function ownRelease(version: string): Promise<OwnRelease> {
  const encoder = new TextEncoder();
  const built = { [MODULE_FILE]: encoder.encode(MODULE), [MAP_FILE]: encoder.encode('{"version":3,"sources":[],"mappings":""}') };
  const manifest = await bundleManifest({ version, schema: OWN_SCHEMA, config: CONFIG, files: built });
  const pins = { [version]: { source: "0".repeat(64), bundle: await releaseDigest(encoder.encode(manifest)), schema: OWN_SCHEMA } };
  const published: Readonly<Record<string, string | Uint8Array<ArrayBuffer>>> = {
    "latest.json": JSON.stringify({ version, released: "2026-12-01", notes: `https://github.com/Vivswan/poplin/releases/tag/v${version}`, schema: OWN_SCHEMA }),
    "releases.json": JSON.stringify(pins),
    [bundleAsset(version, MANIFEST_FILE)]: manifest,
    [bundleAsset(version, MODULE_FILE)]: built[MODULE_FILE],
    [bundleAsset(version, MAP_FILE)]: built[MAP_FILE],
  };
  const uploads: Uploaded[] = [];

  return {
    uploads,
    upload: { kept: OWN_BINDINGS.filter((name) => name !== "MINUTE_LIMITS"), observability: { enabled: true }, module: MODULE, map: true },
    latest: {
      fetch: async (address) => {
        const file = published[address.slice(address.lastIndexOf("/") + 1)];

        return file === undefined ? new Response("no such file", { status: 404 }) : new Response(file);
      },
    },
    cloudflare: async (input, init) => {
      // The SDK asks its `fetch` once what a form is sent as.
      if (typeof input === "string" && input.startsWith("data:")) return new Response("");

      const request = new Request(input, init);
      if (request.headers.get("authorization") !== `Bearer ${OWN_KEY}`) return new Response("no such key", { status: 401 });

      if (request.method !== "GET") {
        uploads.push(await uploadOf(request));

        return result({ id: "poplin" });
      }

      return result(new URL(request.url).pathname.endsWith("/schedules") ? { schedules: [{ cron: "*/15 * * * *" }] } : { bindings: OWN_BINDINGS.map((name) => ({ name, type: "plain_text" })) });
    },
  };
}
