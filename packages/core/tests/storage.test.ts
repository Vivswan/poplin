import { describe, expect, test } from "bun:test";

import { MemoryStore } from "../src/storage/memory";
import { type ByteRange, deletePrefix, type ListOptions, type ListPage, type ObjectKey, parseObjectKey, resolveRange } from "../src/storage/storage";
import { bytesOf, describeObjectStore, objectKey, readText } from "./storage-contract";

/** A key of exactly the 1024 bytes R2 and S3 accept. */
const LONGEST_KEY = "k".repeat(1024);

/** A Worker request on Cloudflare's Free plan gets 50 subrequests; one removal leaves ten for the rest of the request. */
const CALLS_ONE_REMOVAL_MAY_SPEND = 40;

/** A store that counts the calls a removal spends, and lists one object a page so a small folder has many pages. */
class CountingStore extends MemoryStore {
  calls = 0;

  override async list(options: ListOptions): Promise<ListPage> {
    this.calls += 1;

    return super.list({ ...options, limit: 1 });
  }

  override async deleteMany(keys: readonly ObjectKey[]): Promise<void> {
    this.calls += 1;

    return super.deleteMany(keys);
  }
}

async function folderOfFifty(): Promise<CountingStore> {
  const store = new CountingStore();
  const keys = Array.from({ length: 50 }, (_unused, at) => `blog/v${at}/index.html`);
  for (const key of [...keys, "blog2/v1/index.html"]) await store.write(objectKey(key), bytesOf(key), { contentType: "text/plain" });

  return store;
}

describe("parseObjectKey", () => {
  // Drift: a key becomes a bucket path and part of a URL; one that R2 and S3 normalise differently would be written here and read nowhere.
  test.each([
    [".settings", { ok: true, key: ".settings" }],
    ["sites/blog/v1/index.html", { ok: true, key: "sites/blog/v1/index.html" }],
    ["sites/caf\u00e9/a b.html", { ok: true, key: "sites/caf\u00e9/a b.html" }],
    ["sites/.../x", { ok: true, key: "sites/.../x" }],
    ["sales/100%/a%2eb.html", { ok: true, key: "sales/100%/a%2eb.html" }],
    ["sites/%2e%2e%2e/%zz", { ok: true, key: "sites/%2e%2e%2e/%zz" }],
    ["sites/%252e%252e/x", { ok: true, key: "sites/%252e%252e/x" }],
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
    ["a/%2e%2e/b", { ok: false, refusal: "dot-segment" }],
    ["a/%2E%2e/b", { ok: false, refusal: "dot-segment" }],
    ["a/.%2e/b", { ok: false, refusal: "dot-segment" }],
    ["a/%2E./b", { ok: false, refusal: "dot-segment" }],
    ["%2e/sites", { ok: false, refusal: "dot-segment" }],
    ["sites/%2E", { ok: false, refusal: "dot-segment" }],
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
    [{ offset: 0 }, Number.NaN],
    [{ suffix: 1 }, Number.POSITIVE_INFINITY],
    [{ offset: 0 }, 0.5],
    [{ suffix: 1 }, -1],
    [{ offset: 0, length: 1 }, Number.MAX_SAFE_INTEGER + 1],
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
    const key = objectKey("blog/v1/data.txt");
    const bytes = body();
    const written = await store.write(key, bytes, { contentType: "text/plain" });
    const handedOut = await store.read(key);

    bytes.fill(0);
    if (handedOut.kind === "found") new Uint8Array(await new Response(handedOut.body).arrayBuffer()).fill(0);

    expect<unknown>(await readText(store, key)).toEqual({
      kind: "found",
      info: { key, size: 4, etag: written.etag, contentType: "text/plain" },
      span: { offset: 0, length: 4 },
      text: "kept",
    });
  });
});

describe("deletePrefix", () => {
  // Drift: the Free plan ends a request at 50 subrequests; a removal that spent more would fail half way through a large site, every time.
  test("a folder of more pages than one call walks: the default stops inside what one request may spend, and says more remain", async () => {
    const store = await folderOfFifty();
    const outcome = await deletePrefix(store, "blog/");

    expect(outcome.more).toBe(true);
    expect(store.calls).toBeLessThan(CALLS_ONE_REMOVAL_MAY_SPEND);
    expect(store.calls).toBe(outcome.removed * 2);
  });

  test("a page limit of three spends three lists and three deletes a call, and calls repeated while more remain empty the folder and nothing beside it", async () => {
    const store = await folderOfFifty();
    const first = await deletePrefix(store, "blog/", 3);
    const spent = store.calls;

    let outcome = first;
    let removed = first.removed;

    while (outcome.more) {
      outcome = await deletePrefix(store, "blog/", 3);
      removed += outcome.removed;
    }

    const left = await store.list({ prefix: "" });

    expect<unknown>([first, spent, removed, left.objects.map((object) => object.key)]).toEqual([{ removed: 3, more: true }, 6, 50, ["blog2/v1/index.html"]]);
  });

  // Drift: the walk stops when its page count meets the limit; a limit it can never meet would walk a whole bucket in one request.
  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("a page limit of %d is refused before anything is listed", async (maxPages) => {
    const store = await folderOfFifty();

    await expect(deletePrefix(store, "blog/", maxPages)).rejects.toBeInstanceOf(RangeError);
    expect(store.calls).toBe(0);
  });
});

describeObjectStore("MemoryStore", () => new MemoryStore());
