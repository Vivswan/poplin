// This pins what an install reads as the manifest of a release's built files: a rule dropped here lets a file the manifest never stated, or one of another size or digest, pass as the release's own.

import { describe, expect, test } from "bun:test";

import { releaseDigest } from "../../src/records/release";
import { bundleFileProblem, readBundle } from "../../src/records/release-bundle";

/** Turns a text into the bytes of a file. */
const ENCODER = new TextEncoder();

/** A digest of the published form. */
const DIGEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

/** The portable part of a manifest of two files. */
const BUNDLE = { version: "0.2.0", schema: 2, files: { "worker.js": { sha256: DIGEST, bytes: 12 }, "worker.js.map": { sha256: DIGEST, bytes: 34 } } };

/** The manifest with one file's statement replaced. */
function withFile(stated: unknown): unknown {
  return { ...BUNDLE, files: { "worker.js": stated } };
}

describe("readBundle", () => {
  const texts: readonly { readonly name: string; readonly manifest: unknown; readonly read: unknown }[] = [
    { name: "a manifest of two files", manifest: BUNDLE, read: { ok: true, bundle: BUNDLE } },
    // A key this version does not know is passed over, never refused: the provider's part of the manifest is one, and a later poplin may add another to a file an older install reads.
    { name: "a manifest with the provider's part, and a key a later poplin added", manifest: { ...BUNDLE, deploy: { main_module: "worker.js" }, signed: true }, read: { ok: true, bundle: BUNDLE } },
    { name: "a file with a key a later poplin added", manifest: withFile({ sha256: DIGEST, bytes: 12, gzip: 5 }), read: { ok: true, bundle: { ...BUNDLE, files: { "worker.js": { sha256: DIGEST, bytes: 12 } } } } },
    { name: "a list", manifest: [], read: { ok: false, problem: "is not a manifest" } },
    { name: "a number", manifest: 7, read: { ok: false, problem: "is not a manifest" } },
    { name: "no version", manifest: { schema: 2, files: BUNDLE.files }, read: { ok: false, problem: "names no version such as 0.2.0" } },
    { name: "a version with a `v` in front", manifest: { ...BUNDLE, version: "v0.2.0" }, read: { ok: false, problem: "names no version such as 0.2.0" } },
    { name: "a version before its release", manifest: { ...BUNDLE, version: "0.2.0-rc.1" }, read: { ok: false, problem: "names no version such as 0.2.0" } },
    { name: "no schema", manifest: { version: "0.2.0", files: BUNDLE.files }, read: { ok: false, problem: "gives a schema that is not a whole number from 1 up" } },
    { name: "a schema of zero", manifest: { ...BUNDLE, schema: 0 }, read: { ok: false, problem: "gives a schema that is not a whole number from 1 up" } },
    { name: "a schema below zero", manifest: { ...BUNDLE, schema: -2 }, read: { ok: false, problem: "gives a schema that is not a whole number from 1 up" } },
    { name: "a schema that is no whole number", manifest: { ...BUNDLE, schema: 2.5 }, read: { ok: false, problem: "gives a schema that is not a whole number from 1 up" } },
    { name: "a schema written as text", manifest: { ...BUNDLE, schema: "2" }, read: { ok: false, problem: "gives a schema that is not a whole number from 1 up" } },
    { name: "no files", manifest: { version: "0.2.0", schema: 2 }, read: { ok: false, problem: "names no file" } },
    { name: "files that name none", manifest: { ...BUNDLE, files: {} }, read: { ok: false, problem: "names no file" } },
    { name: "a list in place of the files", manifest: { ...BUNDLE, files: [{ sha256: DIGEST, bytes: 12 }] }, read: { ok: false, problem: "names no file" } },
    { name: "a file in a folder", manifest: { ...BUNDLE, files: { "../worker.js": BUNDLE.files["worker.js"] } }, read: { ok: false, problem: "names a file whose name is not lowercase letters, digits, and single dots" } },
    { name: "a file named in capitals", manifest: { ...BUNDLE, files: { "Worker.js": BUNDLE.files["worker.js"] } }, read: { ok: false, problem: "names a file whose name is not lowercase letters, digits, and single dots" } },
    { name: "a file with no digest", manifest: withFile({ bytes: 12 }), read: { ok: false, problem: "gives a digest that is not 64 lowercase hex characters" } },
    { name: "a digest in capitals", manifest: withFile({ sha256: DIGEST.toUpperCase(), bytes: 12 }), read: { ok: false, problem: "gives a digest that is not 64 lowercase hex characters" } },
    { name: "a digest one character short", manifest: withFile({ sha256: DIGEST.slice(1), bytes: 12 }), read: { ok: false, problem: "gives a digest that is not 64 lowercase hex characters" } },
    { name: "a file with no size", manifest: withFile({ sha256: DIGEST }), read: { ok: false, problem: "gives a size that is not a whole number of bytes from 1 up" } },
    { name: "a file of no bytes", manifest: withFile({ sha256: DIGEST, bytes: 0 }), read: { ok: false, problem: "gives a size that is not a whole number of bytes from 1 up" } },
  ];

  // Drift: a manifest read loosely names a release with no file to take, or states a digest no file can match; each refusal says which, so the run that stopped names its own cause.
  test.each(texts)("$name is read as $read", ({ manifest, read }) => {
    expect<unknown>(readBundle(JSON.stringify(manifest))).toEqual(read);
  });

  // Drift: a record passes over a key every object has; a manifest whose one file is such a name would be read as a release with no file, and named.
  test.each([
    ["__proto__", "names a file whose name is not lowercase letters, digits, and single dots"],
    ["constructor", "names no file"],
  ])("a manifest whose one file is named %s is refused: it %s", (name, problem) => {
    expect(readBundle(`{"version":"0.2.0","schema":2,"files":{"${name}":${JSON.stringify(BUNDLE.files["worker.js"])}}}`)).toEqual({ ok: false, problem });
  });

  test.each(["<!doctype html>", "", '{"version": "0.2.0"'])("the text %p, which is no JSON, is no manifest", (text) => {
    expect(readBundle(text)).toEqual({ ok: false, problem: "is not a manifest" });
  });

});

describe("bundleFileProblem", () => {
  const bytes = ENCODER.encode("the built module");

  const files: readonly { readonly name: string; readonly file: string; readonly fetched: Uint8Array<ArrayBuffer>; readonly problem: string | undefined }[] = [
    { name: "the bytes the manifest states", file: "worker.js", fetched: bytes, problem: undefined },
    { name: "one byte changed", file: "worker.js", fetched: ENCODER.encode("the built modulo"), problem: "has another SHA-256 digest than the manifest says" },
    { name: "one byte more", file: "worker.js", fetched: ENCODER.encode("the built module "), problem: "holds 17 bytes, and the manifest says 16" },
    { name: "no bytes", file: "worker.js", fetched: new Uint8Array(0), problem: "holds 0 bytes, and the manifest says 16" },
    { name: "a file the manifest does not name", file: "other.js", fetched: bytes, problem: "is not named by the manifest" },
    { name: "a member every object has", file: "constructor", fetched: bytes, problem: "is not named by the manifest" },
  ];

  // Drift: this is the one link between the digest the website publishes and the code that runs; a check dropped here takes any bytes under a stated name.
  test.each(files)("$name: $problem", async ({ file, fetched, problem }) => {
    const bundle = { version: "0.2.0", schema: 2, files: { "worker.js": { sha256: await releaseDigest(bytes), bytes: bytes.byteLength } } };

    expect(await bundleFileProblem(bundle, file, fetched)).toBe(problem);
  });
});
