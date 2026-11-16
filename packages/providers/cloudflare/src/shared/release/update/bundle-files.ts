// The built files of one release, fetched from the release's page and taken only as what the project published.
//
//   the website's digest of the manifest   ==   the SHA-256 of the manifest fetched     else digest_differs
//   the manifest's version and schema      ==   the release asked for, as published      else other_version
//   the manifest's digest and size, per file   ==   each file fetched                     else digest_differs
//
// A file is read no further than the size the manifest states, so a page that sends more is refused without being read whole.
// The source map goes along when the manifest names one of 16 MiB at most; a release with a larger one, or none, is taken without it.
// Where the files come from is trusted for nothing, and a manifest this code cannot read as an upload is refused: `needs_hand`.

import { bundleFileProblem, readBundle } from "@poplin/core/src/records/release-bundle";
import { type ReleasePins, releaseDigest } from "@poplin/core/src/records/release";
import { concatUint8Arrays } from "uint8array-extras";
import * as v from "valibot";
import { MAP_FILE, MODULE_FILE } from "../publish/bundle-manifest";
import { bundleAddress, MANIFEST_FILE } from "../publish/release-source";

/** The most bytes of a manifest that are read. */
const MOST_MANIFEST_BYTES = 65_536;

/** The largest source map that goes along with an update. */
const MOST_MAP_BYTES = 16_777_216;

/** How long the release's page may take to answer for one file, in milliseconds. */
const ANSWER_WITHIN = 60_000;

/** One binding as the manifest states it: `kept` is the install's own thing, by its name alone, and `stated` carries the whole value the release decides. */
const BINDING = v.variant("kind", [
  v.object({ name: v.string(), kind: v.literal("kept") }),
  v.object({ name: v.string(), kind: v.literal("stated"), binding: v.record(v.string(), v.unknown()) }),
]);

/** The part of a manifest an upload states beside the files, as JSON text. A key a later poplin added is passed over. */
const DEPLOY_PART = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    deploy: v.object({
      main_module: v.literal(MODULE_FILE),
      compatibility_date: v.pipe(v.string(), v.isoDate()),
      compatibility_flags: v.array(v.string()),
      bindings: v.array(BINDING),
      crons: v.array(v.string()),
      observability: v.optional(v.record(v.string(), v.unknown())),
    }),
  }),
);

/** What an upload states beside the files. */
type DeployPart = Readonly<v.InferOutput<typeof DEPLOY_PART>["deploy"]>;

/** The files of one release that passed every check. */
export interface CheckedBundle {
  /** The version the files are of. */
  readonly version: string;

  /** What an upload states beside them. */
  readonly deploy: DeployPart;

  /** The built module. */
  readonly module: Uint8Array<ArrayBuffer>;

  /** Its source map, where one goes along. */
  readonly map: Uint8Array<ArrayBuffer> | undefined;
}

/** What the files are fetched through: the platform's own `fetch`, which follows the page's redirect, or a stand-in. */
export interface Reach {
  readonly fetch: (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;
}

/** Why the files of a release are not taken. */
type Why = "unreachable" | "digest_differs" | "other_version" | "needs_hand";

/** The checked files, or why there are none. */
type Checked = { readonly ok: true; readonly bundle: CheckedBundle } | { readonly ok: false; readonly why: Why };

/** Read a body up to a cap. `undefined` is a body above it; the stream is cancelled either way. */
async function bytesUpTo(body: ReadableStream<Uint8Array>, most: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes += chunk.value.byteLength;
      if (bytes > most) return undefined;

      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return concatUint8Arrays(chunks, bytes);
}

/** Fetch one asset of a release, read up to a cap. `longer` is a body above the cap, and `unreachable` anything but a 200 with a body in time. */
async function fetchAsset(reach: Reach, version: string, file: string, most: number): Promise<Uint8Array<ArrayBuffer> | "unreachable" | "longer"> {
  try {
    const answer = await reach.fetch(bundleAddress(version, file), { signal: AbortSignal.timeout(ANSWER_WITHIN) });
    if (answer.status !== 200 || answer.body === null) {
      await answer.body?.cancel();

      return "unreachable";
    }

    return (await bytesUpTo(answer.body, most)) ?? "longer";
  } catch {
    return "unreachable";
  }
}

/** Fetch one built file and check it against the manifest that names it. */
async function checkedFile(reach: Reach, bundle: Parameters<typeof bundleFileProblem>[0], file: string): Promise<Uint8Array<ArrayBuffer> | Exclude<Why, "other_version" | "needs_hand">> {
  const stated = Object.hasOwn(bundle.files, file) ? bundle.files[file] : undefined;
  if (stated === undefined) return "digest_differs";

  const bytes = await fetchAsset(reach, bundle.version, file, stated.bytes);
  if (bytes === "unreachable") return bytes;

  if (bytes === "longer" || (await bundleFileProblem(bundle, file, bytes)) !== undefined) return "digest_differs";

  return bytes;
}

/**
 * Fetch the built files of one release and check each against what the project's website published.
 *
 * @param pin - what the website publishes of that version
 * @returns the files, or why they are not taken; nothing but the release's page is asked, and nothing is changed
 */
export async function checkedBundle(reach: Reach, version: string, pin: ReleasePins[string]): Promise<Checked> {
  const manifest = await fetchAsset(reach, version, MANIFEST_FILE, MOST_MANIFEST_BYTES);
  if (manifest === "unreachable") return { ok: false, why: "unreachable" };

  if (manifest === "longer" || (await releaseDigest(manifest)) !== pin.bundle) return { ok: false, why: "digest_differs" };

  const text = new TextDecoder().decode(manifest);
  const read = readBundle(text);
  const deploy = v.safeParse(DEPLOY_PART, text);
  if (!read.ok || !deploy.success || !Object.hasOwn(read.bundle.files, MODULE_FILE)) return { ok: false, why: "needs_hand" };

  if (read.bundle.version !== version || read.bundle.schema !== pin.schema) return { ok: false, why: "other_version" };

  const module = await checkedFile(reach, read.bundle, MODULE_FILE);
  if (typeof module === "string") return { ok: false, why: module };

  const mapped = Object.hasOwn(read.bundle.files, MAP_FILE) && (read.bundle.files[MAP_FILE]?.bytes ?? 0) <= MOST_MAP_BYTES;
  const map = mapped ? await checkedFile(reach, read.bundle, MAP_FILE) : undefined;
  if (typeof map === "string") return { ok: false, why: map };

  return { ok: true, bundle: { version, deploy: deploy.output.deploy, module, map } };
}
