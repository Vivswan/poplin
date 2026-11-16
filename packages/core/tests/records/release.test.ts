// This pins what an install reads as the published releases: a rule dropped here lets a digest no file can match, or a release with no built files, be taken for one that is out.

import { describe, expect, test } from "bun:test";

import { newestPinned, publishedPins, releaseDigest } from "../../src/records/release";

const ENCODER = new TextEncoder();

describe("releaseDigest", () => {
  // Drift: every other test here makes its digests with this function, so only a value from outside says the published digest is SHA-256.
  test("the digest of `abc` is the one the SHA-256 standard gives for it", async () => {
    expect(await releaseDigest(ENCODER.encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("publishedPins", () => {
  const digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
  const pin = { bundle: digest, schema: 2 };

  const files: readonly { readonly name: string; readonly text: string; readonly read: unknown; readonly newest: string | undefined }[] = [
    { name: "no release yet", text: "{}", read: {}, newest: undefined },
    { name: "two releases, the lower version written last", text: JSON.stringify({ "0.10.0": pin, "0.9.0": pin }), read: { "0.10.0": pin, "0.9.0": pin }, newest: "0.10.0" },
    { name: "a release with a field a later poplin added", text: JSON.stringify({ "0.2.0": { ...pin, pulled: false } }), read: { "0.2.0": pin }, newest: "0.2.0" },
    { name: "a release with no digest", text: JSON.stringify({ "0.2.0": {} }), read: undefined, newest: undefined },
    { name: "a release with no digest of its built files", text: JSON.stringify({ "0.2.0": { schema: 2 } }), read: undefined, newest: undefined },
    { name: "a digest of the built files in capitals", text: JSON.stringify({ "0.2.0": { ...pin, bundle: digest.toUpperCase() } }), read: undefined, newest: undefined },
    { name: "a digest of the built files one character long", text: JSON.stringify({ "0.2.0": { ...pin, bundle: "9" } }), read: undefined, newest: undefined },
    { name: "a release with no schema", text: JSON.stringify({ "0.2.0": { bundle: digest } }), read: undefined, newest: undefined },
    { name: "a schema of zero", text: JSON.stringify({ "0.2.0": { ...pin, schema: 0 } }), read: undefined, newest: undefined },
    { name: "a schema below zero", text: JSON.stringify({ "0.2.0": { ...pin, schema: -1 } }), read: undefined, newest: undefined },
    { name: "a schema that is no whole number", text: JSON.stringify({ "0.2.0": { ...pin, schema: 1.5 } }), read: undefined, newest: undefined },
    { name: "a schema written as text", text: JSON.stringify({ "0.2.0": { ...pin, schema: "2" } }), read: undefined, newest: undefined },
    { name: "one good release beside one with no digest of its built files", text: JSON.stringify({ "0.2.0": pin, "0.1.0": { schema: 1 } }), read: undefined, newest: undefined },
    { name: "a version with a `v` in front", text: JSON.stringify({ "v0.2.0": pin }), read: undefined, newest: undefined },
    { name: "a version before its release", text: JSON.stringify({ "0.2.0-rc.1": pin }), read: undefined, newest: undefined },
    { name: "a list", text: "[]", read: undefined, newest: undefined },
    { name: "a member every object has, as its one key", text: '{"constructor":123}', read: undefined, newest: undefined },
    { name: "a prototype, as its one key", text: '{"__proto__":null}', read: undefined, newest: undefined },
    { name: "a page that is no JSON", text: "<!doctype html>", read: undefined, newest: undefined },
  ];

  // Drift: a file read loosely would hand an update a version that is compared with nothing, a digest no file can match, or a release with no built files to take.
  // A key this version does not know is passed over, never refused: installs of every older version read the file, and the website only ever adds a key.
  test.each(files)("$name is read as $read, and its newest version is $newest", ({ text, read, newest }) => {
    const pins = publishedPins(text);

    expect<unknown>([pins, pins === undefined ? undefined : newestPinned(pins)]).toEqual([read, newest]);
  });
});
