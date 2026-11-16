// The manifest of a release's built Worker: what the release run writes beside the built files, and attests with them.
//
//   version, schema, files   portable: which release it is, how many steps its database has been through, and each built file's digest and size
//   deploy                   Cloudflare's: what an upload of those files states beside them, read from the release's own wrangler.jsonc
//
// A binding to a thing the account holds, or to a value the install's own Worker carries, is `kept`: the bucket, the database, the Workflow, a variable.
// One whose whole value the release decides is `stated`, with that value. The Workflow is named after the install's own Worker and made by the install, so no release states it.
// A setting of wrangler.jsonc this file does not know stops the build: a release cannot ship a setting its manifest leaves out.

import { releaseDigest } from "@poplin/core/src/records/release";
import * as v from "valibot";

/** The built module, as the manifest and an upload name it. */
export const MODULE_FILE = "worker.js";

/** The module's source map. */
export const MAP_FILE = "worker.js.map";

/** A binding by the name the Worker reads it under. */
const NAMED = v.looseObject({ binding: v.string() });

/** The settings of wrangler.jsonc. The ones a build alone reads are named too, so that an unknown one is refused. */
const CONFIG = v.strictObject({
  $schema: v.optional(v.string()),
  name: v.string(),
  main: v.string(),
  compatibility_date: v.pipe(v.string(), v.isoDate()),
  compatibility_flags: v.optional(v.array(v.string()), []),
  minify: v.literal(true),
  upload_source_maps: v.literal(true),
  build: v.strictObject({ command: v.string() }),
  triggers: v.strictObject({ crons: v.array(v.string()) }),
  r2_buckets: v.array(NAMED),
  d1_databases: v.array(NAMED),
  ratelimits: v.array(v.strictObject({ name: v.string(), namespace_id: v.string(), simple: v.strictObject({ limit: v.number(), period: v.number() }) })),
  workflows: v.array(v.strictObject({ name: v.string(), binding: v.string(), class_name: v.string() })),
  vars: v.record(v.string(), v.string()),
  observability: v.optional(v.record(v.string(), v.unknown())),
});

/** One binding of the built Worker, as the manifest states it. */
type Binding = { readonly name: string; readonly kind: "kept" } | { readonly name: string; readonly kind: "stated"; readonly binding: Readonly<Record<string, unknown>> };

/** The release the files were built from. */
interface Built {
  /** Its version, such as `0.2.0`. */
  readonly version: string;

  /** How many steps its database has been through. */
  readonly schema: number;

  /** Its wrangler.jsonc, as parsed JSON. */
  readonly config: unknown;

  /** The bytes of the built module and of its source map. */
  readonly files: { readonly [MODULE_FILE]: Uint8Array<ArrayBuffer>; readonly [MAP_FILE]: Uint8Array<ArrayBuffer> };
}

function bindingsOf(config: v.InferOutput<typeof CONFIG>): readonly Binding[] {
  const things = [...config.r2_buckets, ...config.d1_databases, ...config.workflows].map((thing) => thing.binding);
  const limits = config.ratelimits.map(({ name, ...limit }): Binding => ({ name, kind: "stated", binding: { type: "ratelimit", ...limit } }));

  return [...[...things, ...Object.keys(config.vars)].map((name): Binding => ({ name, kind: "kept" })), ...limits];
}

async function stated(bytes: Uint8Array<ArrayBuffer>): Promise<{ readonly sha256: string; readonly bytes: number }> {
  return { sha256: await releaseDigest(bytes), bytes: bytes.byteLength };
}

/**
 * Write the manifest of a release's built files.
 *
 * @returns the manifest as the text of its file: the same text for the same release, files, and configuration
 * @throws {v.ValiError} the configuration holds a setting this file does not know, or lacks one the manifest states
 */
export async function bundleManifest(built: Built): Promise<string> {
  const config = v.parse(CONFIG, built.config);

  const manifest = {
    version: built.version,
    schema: built.schema,
    files: { [MODULE_FILE]: await stated(built.files[MODULE_FILE]), [MAP_FILE]: await stated(built.files[MAP_FILE]) },
    deploy: {
      main_module: MODULE_FILE,
      compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags,
      bindings: bindingsOf(config),
      crons: config.triggers.crons,
      ...(config.observability === undefined ? {} : { observability: config.observability }),
    },
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}
