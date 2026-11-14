import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { bytesOf, describeObjectStore, objectKey, readText } from "@poplin/core/tests/storage/support/storage-contract";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Bindings } from "../../src/worker/bindings";
import { R2Store } from "../../src/storage/r2";

const BINDINGS: Bindings = env;
const BUCKET = BINDINGS.SITES;
const TEXT = { contentType: "text/plain" } as const;
const DIGITS = "0123456789";

async function emptyStore(): Promise<R2Store> {
  await reset();

  return new R2Store(BUCKET);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describeObjectStore("R2Store", emptyStore);

describe("R2Store: the limits of R2 itself", () => {
  // Drift: R2 refuses a delete of more than 1000 keys and the local simulation takes any number, so only the call sizes show the batching.
  test("delete-many hands R2 at most 1000 keys a call, and every key in exactly one call", async () => {
    await reset();
    const deletes = vi.spyOn(BUCKET, "delete");
    const kept = objectKey("blog/v2/index.html");
    const doomed = Array.from({ length: 2001 }, (_unused, at) => objectKey(`blog/v1/file-${at}`));
    const edges = [doomed[0], doomed[999], doomed[1000], doomed[1999], doomed[2000]].filter((key) => key !== undefined);
    for (const key of [kept, ...edges]) await BUCKET.put(key, "x");

    await new R2Store(BUCKET).deleteMany(doomed);
    const calls = deletes.mock.calls.map(([keys]) => keys);

    expect(calls.map((keys) => keys.length)).toEqual([1000, 1000, 1]);
    expect(calls.flat()).toEqual(doomed);
    expect((await BUCKET.list()).objects.map((object) => object.key)).toEqual([kept]);
  });

  // Drift: R2 throws where HTTP wants a 416; a store that passed the range straight on would turn a visitor's bad Range header into a 500.
  test.each([
    ["an offset at the end", { offset: 10 }],
    ["an offset past the end", { offset: 11, length: 1 }],
    ["an empty suffix", { suffix: 0 }],
    ["an empty length", { offset: 0, length: 0 }],
  ] as const)("%s makes the bucket throw, and the store answer not satisfiable", async (_name, range) => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/data.txt");
    const info = await store.write(key, bytesOf(DIGITS), TEXT);

    await expect(BUCKET.get(key, { range })).rejects.toThrow("not satisfiable");
    expect<unknown>(await store.read(key, { range })).toEqual({ kind: "range-not-satisfiable", info });
  });

  // Drift: core says a write of the same bytes may keep its etag; a visitor's cached copy then stays good across a republish of an unchanged file.
  test("a rewrite of the same bytes keeps the etag, whatever content type it carries", async () => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/data.txt");
    const first = await store.write(key, bytesOf("live: v1"), TEXT);
    const second = await store.write(key, bytesOf("live: v1"), { contentType: "application/json" });

    expect(second.etag).toBe(first.etag);
  });

  // Drift: core refuses a lone surrogate because of what the bucket does with it; if the bucket ever keeps one whole, the refusal has lost its reason.
  test("a lone surrogate in a content type: the bucket stores another type than it was given, and the store never hands it over", async () => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/data.txt");
    await BUCKET.put(key, "live: v1", { httpMetadata: { contentType: "text/plain\ud83d" } });
    const kept = await BUCKET.head(key);
    const puts = vi.spyOn(BUCKET, "put");

    await expect(store.write(key, bytesOf("live: v2"), { contentType: "text/plain\ud83d" })).rejects.toBeInstanceOf(TypeError);
    expect<unknown>([kept?.httpMetadata?.contentType, puts.mock.calls.length]).toEqual(["text/plain\ufffd\ufffd\ufffd", 0]);
  });
});

describe("R2Store: input the store does not control", () => {
  // Drift: the header is a visitor's input; R2 reads `*` as any etag and throws on a quote, where an etag that is not the current one must read as found.
  test.each([
    ["a wildcard", (): string => "*"],
    ["the etag in quotes", (etag: string): string => `"${etag}"`],
    ["the etag marked weak", (etag: string): string => `W/"${etag}"`],
    ["the etag in a list", (etag: string): string => `${etag}, other`],
    ["an empty string", (): string => ""],
  ] as const)("if-none-match holding %s reads the whole object, as the in-memory store answers it", async (_name, sent) => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/data.txt");
    const info = await store.write(key, bytesOf(DIGITS), TEXT);

    expect<unknown>(await readText(store, key, { ifNoneMatch: sent(info.etag) })).toEqual({ kind: "found", info, span: { offset: 0, length: 10 }, text: DIGITS });
  });

  // Drift: a ranged read is two R2 calls; a span worked out for the old object must never be cut from the new one.
  test("a write landing between the two calls of a ranged read: the read answers for the new object", async () => {
    await reset();
    const key = objectKey("blog/v1/data.txt");
    const head = BUCKET.head.bind(BUCKET);
    const heads = vi.spyOn(BUCKET, "head").mockImplementationOnce(async (name) => {
      const before = await head(name);
      await BUCKET.put(name, "abc", { httpMetadata: TEXT });

      return before;
    });
    await BUCKET.put(key, DIGITS, { httpMetadata: TEXT });

    const store = new R2Store(BUCKET);
    const read = await readText(store, key, { range: { suffix: 2 } });
    const calls = heads.mock.calls.length;
    const current = await store.head(key);

    expect<unknown>([calls, read]).toEqual([2, { kind: "found", info: current.kind === "found" ? current.info : undefined, span: { offset: 1, length: 2 }, text: "bc" }]);
  });

  // Drift: the owner can put files in the bucket by other means; one the key rules refuse must stop a listing loudly, not ride along as a key.
  test("an object written past the store: no content type reads as bytes of unknown type, and a key no store wrote stops the listing", async () => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/raw");
    const raw = await BUCKET.put(key, "raw");
    const head = await store.head(key);

    await BUCKET.put("blog/v1/", "a folder marker");

    expect<unknown>(head).toEqual({ kind: "found", info: { key, size: 3, etag: raw?.etag, contentType: "application/octet-stream" } });
    await expect(store.list({ prefix: "" })).rejects.toThrow('empty-segment): "blog/v1/"');
  });

  // Drift: R2 refuses a stream of unknown length, so the declared size is all it checks, and workerd rounds a fraction down; neither may store a cut stream.
  test.each([
    ["runs past its declared size", "longer", 4],
    ["declares a fraction of a byte", "x", 1.5],
  ] as const)("a stream that %s rejects and stores nothing", async (_name, text, size) => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/app.js");
    const stream = new Response(text).body as ReadableStream<Uint8Array>;

    await expect(store.write(key, { stream, size }, TEXT)).rejects.toBeInstanceOf(Error);
    expect<unknown>(await store.head(key)).toEqual({ kind: "missing" });
  });
});
