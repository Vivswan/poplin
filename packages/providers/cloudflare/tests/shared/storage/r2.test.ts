import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { bytesOf, describeObjectStore, objectKey, readText } from "@poplin/core/tests/storage/support/storage-contract";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Bindings } from "../../../src/shared/worker/bindings";
import { R2Store } from "../../../src/shared/storage/r2";

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

  // Drift: R2 bills every get and every head past a month's free ten million, and serving counts three calls a request. A ranged read that looked at the object first would be a fourth.
  test.each([
    ["a part of a file", { range: { offset: 2, length: 3 } }, "found", { get: 1, head: 0 }],
    ["the end of a file", { range: { suffix: 2 } }, "found", { get: 1, head: 0 }],
    ["a part of a file, with a tag that is not its own", { range: { offset: 2 }, ifNoneMatch: "another" }, "found", { get: 1, head: 0 }],
    ["a part of a file that holds no file", { range: { offset: 2 } }, "missing", { get: 1, head: 0 }],
    ["a part past the end, which costs the look that says the size", { range: { offset: 99 } }, "range-not-satisfiable", { get: 1, head: 1 }],
    ["an empty part", { range: { offset: 0, length: 0 } }, "range-not-satisfiable", { get: 1, head: 1 }],
  ] as const)("a read of %s is %s at the bucket's calls %j", async (name, options, kind, calls) => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/data.txt");
    if (!name.includes("holds no file")) await store.write(key, bytesOf(DIGITS), TEXT);

    const gets = vi.spyOn(BUCKET, "get");
    const heads = vi.spyOn(BUCKET, "head");
    const read = await store.read(key, options);
    if (read.kind === "found") await read.body.cancel();

    expect([read.kind, { get: gets.mock.calls.length, head: heads.mock.calls.length }]).toEqual([kind, calls]);
  });

  // Drift: only a range that selects no byte is answered from a second look. Any other failure of the bucket must stay a failure, or a broken bucket would read as a file that is not there.
  test("a ranged read the bucket fails for another reason than its range is thrown as it was", async () => {
    const store = await emptyStore();
    const key = objectKey("blog/v1/data.txt");
    await store.write(key, bytesOf(DIGITS), TEXT);
    vi.spyOn(BUCKET, "get").mockRejectedValueOnce(new Error("the bucket is down"));

    await expect(store.read(key, { range: { offset: 2 } })).rejects.toThrow("the bucket is down");
  });

  // Drift: a key that holds nothing is answered by the bucket's get, never thrown. A failed get read as "no such file" would send serving on to the next key, past its three calls, and answer a broken bucket with a 404.
  test("a ranged read the bucket fails, of a key the second look finds empty, is thrown as it was", async () => {
    const store = await emptyStore();
    vi.spyOn(BUCKET, "get").mockRejectedValueOnce(new Error("the bucket is down"));

    await expect(store.read(objectKey("blog/v1/data.txt"), { range: { offset: 2 } })).rejects.toThrow("the bucket is down");
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
