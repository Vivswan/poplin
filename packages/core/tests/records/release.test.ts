// This pins what an install takes as a release: a rule dropped here lets files nobody published, or an older version, become the code that runs.

import { describe, expect, test } from "bun:test";

import { checkedRelease, newestPinned, publishedPins, type ReleasePins, releaseDigest } from "../../src/records/release";

const ENCODER = new TextEncoder();

/** The files of a release, as bytes that say their own version in the open; `none` makes files that say no version. */
function filesOf(version: string): Uint8Array<ArrayBuffer> {
  return ENCODER.encode(version === "none" ? "files that say no version" : `the files of poplin ${version}`);
}

/** The version a run of bytes made by `filesOf` says it is. */
function versionOf(bytes: Uint8Array<ArrayBuffer>): Promise<string | undefined> {
  return Promise.resolve(/ (\d+\.\d+\.\d+)$/.exec(new TextDecoder().decode(bytes))?.[1]);
}

/** A website that published these versions, each with the digest of the files given for it. */
async function pinsOf(published: Readonly<Record<string, Uint8Array<ArrayBuffer>>>): Promise<ReleasePins> {
  const entries = await Promise.all(Object.entries(published).map(async ([version, bytes]) => [version, { source: await releaseDigest(bytes) }] as const));

  return Object.fromEntries(entries);
}

describe("checkedRelease", () => {
  const two = { "0.2.0": "0.2.0", "0.3.0": "0.3.0" };
  const taken = (version: string): unknown => ({ ok: true, bytes: filesOf(version) });
  const refused = (refusal: string, says?: string): unknown => ({ ok: false, refusal, ...(says === undefined ? {} : { says }) });

  /** A release that is wanted, the versions the website published with the version each digest's files say, the version the served files say, and what comes of it. */
  const cases: readonly {
    readonly name: string;
    readonly wanted: { readonly version: string; readonly running?: string };
    readonly published: Readonly<Record<string, string>>;
    readonly served: string | undefined;
    readonly changed?: true;
    readonly outcome: unknown;
    readonly fetched: boolean;
    readonly opened: boolean;
  }[] = [
    { name: "the files the website published", wanted: { version: "0.3.0" }, published: two, served: "0.3.0", outcome: taken("0.3.0"), fetched: true, opened: true },
    { name: "the same files, for a taker that runs an older version", wanted: { version: "0.3.0", running: "0.2.0" }, published: two, served: "0.3.0", outcome: taken("0.3.0"), fetched: true, opened: true },
    { name: "the same files, for a taker that runs that version", wanted: { version: "0.3.0", running: "0.3.0" }, published: two, served: "0.3.0", outcome: taken("0.3.0"), fetched: true, opened: true },
    { name: "an older version a person named, with no running version given", wanted: { version: "0.2.0" }, published: two, served: "0.2.0", outcome: taken("0.2.0"), fetched: true, opened: true },
    { name: "files with one bit changed", wanted: { version: "0.3.0" }, published: two, served: "0.3.0", changed: true, outcome: refused("digest_differs"), fetched: true, opened: false },
    { name: "the files of another release, served under this version", wanted: { version: "0.3.0" }, published: two, served: "0.2.0", outcome: refused("digest_differs"), fetched: true, opened: false },
    { name: "a version with no digest published", wanted: { version: "0.4.0" }, published: two, served: "0.4.0", outcome: refused("no_digest"), fetched: false, opened: false },
    { name: "a version named like a member every object has", wanted: { version: "constructor" }, published: two, served: "0.2.0", outcome: refused("no_digest"), fetched: false, opened: false },
    { name: "a digest published for files that say another version", wanted: { version: "0.3.0" }, published: { "0.3.0": "0.2.0" }, served: "0.2.0", outcome: refused("other_version", "0.2.0"), fetched: true, opened: true },
    { name: "a digest published for files that say no version", wanted: { version: "0.3.0" }, published: { "0.3.0": "none" }, served: "none", outcome: refused("other_version"), fetched: true, opened: true },
    { name: "a version older than the one that runs", wanted: { version: "0.2.0", running: "0.3.0" }, published: two, served: "0.2.0", outcome: refused("older"), fetched: false, opened: false },
    { name: "files that cannot be fetched", wanted: { version: "0.3.0" }, published: two, served: undefined, outcome: refused("unreachable"), fetched: true, opened: false },
  ];

  // Drift: files whose digest differs must never be opened, so what reads a version out of them is handed only bytes the website published.
  test.each(cases)("$name: taken or refused as $outcome, with the files fetched ($fetched) and opened ($opened) only then", async ({ wanted, published, served, changed, outcome, fetched, opened }) => {
    const asked: string[] = [];
    const read: Uint8Array[] = [];
    const files = {
      fetch: (version: string): Promise<Uint8Array<ArrayBuffer> | undefined> => {
        asked.push(version);
        if (served === undefined) return Promise.resolve(undefined);

        const bytes = filesOf(served);
        if (changed === true) bytes[0] = (bytes[0] ?? 0) ^ 1;

        return Promise.resolve(bytes);
      },
      versionOf: (bytes: Uint8Array<ArrayBuffer>): Promise<string | undefined> => {
        read.push(bytes);

        return versionOf(bytes);
      },
    };
    const pins = await pinsOf(Object.fromEntries(Object.entries(published).map(([version, says]) => [version, filesOf(says)])));

    expect<unknown>([await checkedRelease(wanted, pins, files), asked, read.length]).toEqual([outcome, fetched ? [wanted.version] : [], opened ? 1 : 0]);
  });
});

describe("releaseDigest", () => {
  // Drift: every other test here makes its digests with this function, so only a value from outside says the published digest is SHA-256.
  test("the digest of `abc` is the one the SHA-256 standard gives for it", async () => {
    expect(await releaseDigest(ENCODER.encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("publishedPins", () => {
  const digest = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

  const files: readonly { readonly name: string; readonly text: string; readonly read: unknown; readonly newest: string | undefined }[] = [
    { name: "no release yet", text: "{}", read: {}, newest: undefined },
    { name: "two releases, the lower version written last", text: JSON.stringify({ "0.10.0": { source: digest }, "0.9.0": { source: digest } }), read: { "0.10.0": { source: digest }, "0.9.0": { source: digest } }, newest: "0.10.0" },
    { name: "a release with a field a later poplin added", text: JSON.stringify({ "0.2.0": { source: digest, bundle: digest } }), read: { "0.2.0": { source: digest } }, newest: "0.2.0" },
    { name: "a digest in capitals", text: JSON.stringify({ "0.2.0": { source: digest.toUpperCase() } }), read: undefined, newest: undefined },
    { name: "a digest one character short", text: JSON.stringify({ "0.2.0": { source: digest.slice(1) } }), read: undefined, newest: undefined },
    { name: "a release with no digest", text: JSON.stringify({ "0.2.0": {} }), read: undefined, newest: undefined },
    { name: "a version with a `v` in front", text: JSON.stringify({ "v0.2.0": { source: digest } }), read: undefined, newest: undefined },
    { name: "a version before its release", text: JSON.stringify({ "0.2.0-rc.1": { source: digest } }), read: undefined, newest: undefined },
    { name: "a list", text: "[]", read: undefined, newest: undefined },
    { name: "a member every object has, as its one key", text: '{"constructor":123}', read: undefined, newest: undefined },
    { name: "a prototype, as its one key", text: '{"__proto__":null}', read: undefined, newest: undefined },
    { name: "a page that is no JSON", text: "<!doctype html>", read: undefined, newest: undefined },
  ];

  // Drift: a file read loosely would hand the deploy a version that is compared with nothing, or a digest no file can match.
  test.each(files)("$name is read as $read, and its newest version is $newest", ({ text, read, newest }) => {
    const pins = publishedPins(text);

    expect<unknown>([pins, pins === undefined ? undefined : newestPinned(pins)]).toEqual([read, newest]);
  });
});
