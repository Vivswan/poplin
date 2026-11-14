import { describe, expect, test } from "bun:test";

import { MemoryStore } from "../src/storage/memory";
import { type ByteRange, parseObjectKey, resolveRange } from "../src/storage/storage";
import { bytesOf, describeObjectStore, objectKey, readText } from "./storage-contract";

const LONGEST_KEY = "k".repeat(1024);

describe("parseObjectKey", () => {
  // Drift: a key becomes a bucket path and part of a URL; one that R2 and S3 normalise differently would be written here and read nowhere.
  test.each([
    [".settings", { ok: true, key: ".settings" }],
    ["sites/blog/v1/index.html", { ok: true, key: "sites/blog/v1/index.html" }],
    ["sites/caf\u00e9/a b.html", { ok: true, key: "sites/caf\u00e9/a b.html" }],
    ["sites/.../x", { ok: true, key: "sites/.../x" }],
    [LONGEST_KEY, { ok: true, key: LONGEST_KEY }],
    ["", { ok: false, refusal: "empty" }],
    [`${LONGEST_KEY}k`, { ok: false, refusal: "too-long" }],
    ["\u00e9".repeat(513), { ok: false, refusal: "too-long" }],
    ["sites/a\nb", { ok: false, refusal: "bad-character" }],
    ["sites/a\u0000", { ok: false, refusal: "bad-character" }],
    ["sites/\ud83d", { ok: false, refusal: "bad-character" }],
    ["sites/cafe\u0301/index.html", { ok: false, refusal: "not-normalized" }],
    ["/sites", { ok: false, refusal: "empty-segment" }],
    ["sites/", { ok: false, refusal: "empty-segment" }],
    ["sites//blog", { ok: false, refusal: "empty-segment" }],
    ["sites/../.settings", { ok: false, refusal: "dot-segment" }],
    ["./sites", { ok: false, refusal: "dot-segment" }],
    ["..", { ok: false, refusal: "dot-segment" }],
  ] as ReadonlyArray<readonly [string, unknown]>)("decides %j", (raw, outcome) => {
    expect<unknown>(parseObjectKey(raw)).toEqual(outcome);
  });
});

describe("resolveRange", () => {
  // Drift: a Range header is a visitor's input; a number no store can seek to must become a 416, never a slice at a wrong offset.
  test.each([
    [{ offset: -1 }, 10],
    [{ offset: 1.5 }, 10],
    [{ offset: Number.NaN }, 10],
    [{ offset: 0, length: 0 }, 10],
    [{ offset: 0, length: -3 }, 10],
    [{ suffix: -2 }, 10],
    [{ suffix: 2.5 }, 10],
    [{ offset: 0 }, 0],
    [{ suffix: 4 }, 0],
  ] as ReadonlyArray<readonly [ByteRange, number]>)("%j of %d bytes selects nothing", (range, size) => {
    expect(resolveRange(range, size)).toBe("unsatisfiable");
  });
});

describe("MemoryStore", () => {
  // Drift: a test that edits a buffer it already wrote would otherwise change the stored site with no write and no new etag.
  test.each([
    ["a plain Uint8Array", (): Uint8Array => bytesOf("kept")],
    ["a Buffer, whose slice shares memory", (): Uint8Array => Buffer.from("kept")],
  ] as const)("what the caller wrote as %s and what it was handed are copies: changing either afterwards changes nothing stored", async (_form, body) => {
    const store = new MemoryStore();
    const key = objectKey("sites/blog/record");
    const bytes = body();
    const metadata = { state: "private" };
    const written = await store.write(key, bytes, { contentType: "text/plain", metadata });
    const handedOut = await store.read(key);

    bytes.fill(0);
    metadata.state = "public";
    (written.metadata as Record<string, string>).state = "public";
    if (handedOut.kind === "found") new Uint8Array(await new Response(handedOut.body).arrayBuffer()).fill(0);

    expect<unknown>(await readText(store, key)).toEqual({
      kind: "found",
      info: { key, size: 4, etag: written.etag, contentType: "text/plain", metadata: { state: "private" } },
      span: { offset: 0, length: 4 },
      text: "kept",
    });
  });
});

describeObjectStore("MemoryStore", () => new MemoryStore());
