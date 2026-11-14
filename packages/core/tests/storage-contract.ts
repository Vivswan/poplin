// The contract every `ObjectStore` keeps, as test cases that take a store factory. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import {
  type ByteRange,
  type ListOptions,
  type ListPage,
  MAX_LIST_LIMIT,
  type ObjectInfo,
  type ObjectKey,
  type ObjectStore,
  parseObjectKey,
  type ReadOptions,
  type WriteCondition,
} from "../src/storage/storage";

/** The options of a write whose type and metadata the case does not look at. */
const TEXT = { contentType: "text/plain" } as const;

/** Ten bytes, each naming its own offset, so a ranged read shows which bytes came back. */
const DIGITS = "0123456789";

/** An etag in no store's form, standing for a visitor's stale copy. */
const STALE_ETAG = "an-etag-no-store-issued";

/** Keys at four depths. U+FF5E sorts before U+1F600 in UTF-8 bytes and after it in UTF-16 units. */
const LISTED_KEYS = [
  ".settings",
  "sites/blog/record",
  "sites/blog/v1/index.html",
  "sites/blog/v2/index.html",
  "sites/docs/record",
  "sites/readme",
  "sites/\uff5e",
  "sites/\u{1f600}",
  "sitesmap",
] as const;

type StoreFactory = () => ObjectStore | Promise<ObjectStore>;

/** A fixture key; a string that is no key is a broken fixture, so it throws. */
export function objectKey(raw: string): ObjectKey {
  const parsed = parseObjectKey(raw);
  if (!parsed.ok) throw new Error(`fixture is not an object key: ${raw}`);

  return parsed.key;
}

/** The UTF-8 bytes of a fixture text. */
export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new Response(text).body as ReadableStream<Uint8Array>;
}

/** A read with its body drained to text, so one comparison covers the bytes and everything beside them. */
export async function readText(store: ObjectStore, key: ObjectKey, options?: ReadOptions): Promise<unknown> {
  const result = await store.read(key, options);
  if (result.kind !== "found") return result;

  return { kind: result.kind, info: result.info, span: result.span, text: await new Response(result.body).text() };
}

async function seed(store: ObjectStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) await store.write(objectKey(key), bytesOf(key), TEXT);
}

// Every page of a listing, whatever sizes the store chooses: a page may be short, or empty, while more remain.
async function listEveryPage(store: ObjectStore, options: Omit<ListOptions, "cursor">): Promise<ListPage[]> {
  const pages: ListPage[] = [];
  let page = await store.list(options);

  while (true) {
    pages.push(page);
    if (!page.more) return pages;

    page = await store.list({ ...options, cursor: page.cursor });
  }
}

function keysOf(pages: readonly ListPage[]): string[] {
  return pages.flatMap((page) => page.objects.map((object) => object.key));
}

function foldersOf(pages: readonly ListPage[]): string[] {
  return pages.flatMap((page) => [...page.folders]);
}

function readingAndWriting(label: string, makeStore: StoreFactory): void {
  describe(`${label}: reading and writing`, () => {
    test("a key nothing was written to answers missing from head and read, so a first publish never needs a catch", async () => {
      const store = await makeStore();
      const key = objectKey("sites/blog/record");

      expect<unknown>([await store.head(key), await store.read(key)]).toEqual([{ kind: "missing" }, { kind: "missing" }]);
    });

    // Drift: the site record rides in the bytes and the metadata; a store that drops either serves a site under the wrong type or state.
    test.each([
      ["a buffer", (): Uint8Array => bytesOf("<h1>hi</h1>")],
      ["an ArrayBuffer", (): ArrayBuffer => bytesOf("<h1>hi</h1>").buffer as ArrayBuffer],
      ["a sized stream", (): { stream: ReadableStream<Uint8Array>; size: number } => ({ stream: streamOf("<h1>hi</h1>"), size: 11 })],
    ] as const)("a write from %s reads back whole, with its content type and metadata, from head and read", async (_form, body) => {
      const store = await makeStore();
      const key = objectKey("sites/blog/v1/index.html");
      const written = await store.write(key, body(), { contentType: "text/html; charset=utf-8", metadata: { title: "Blog", state: "private" } });
      const info = { key, size: 11, etag: written.etag, contentType: "text/html; charset=utf-8", metadata: { title: "Blog", state: "private" } };

      expect<unknown>([written, await store.head(key), await readText(store, key)]).toEqual([
        { ...info, etag: expect.any(String) },
        { kind: "found", info },
        { kind: "found", info, span: { offset: 0, length: 11 }, text: "<h1>hi</h1>" },
      ]);
    });

    test("an empty object and absent metadata read back as an empty body and an empty map, not as missing", async () => {
      const store = await makeStore();
      const key = objectKey("sites/blog/empty.css");
      const written = await store.write(key, new Uint8Array(0), { contentType: "text/css" });

      expect<unknown>(await readText(store, key)).toEqual({
        kind: "found",
        info: { key, size: 0, etag: written.etag, contentType: "text/css", metadata: {} },
        span: { offset: 0, length: 0 },
        text: "",
      });
    });

    test("a stream that ends short of its declared size rejects and stores nothing, so a cut upload never becomes a site file", async () => {
      const store = await makeStore();
      const key = objectKey("sites/blog/v1/app.js");

      await expect(store.write(key, { stream: streamOf("short"), size: 9 }, TEXT)).rejects.toBeInstanceOf(Error);
      expect<unknown>(await store.head(key)).toEqual({ kind: "missing" });
    });

    test("a rewrite with other bytes changes the etag and replaces bytes, type, and metadata together", async () => {
      const store = await makeStore();
      const key = objectKey("sites/blog/record");
      const first = await store.write(key, bytesOf("live: v1"), { contentType: "text/plain", metadata: { owner: "ana" } });
      const second = await store.write(key, bytesOf("live: v2"), { contentType: "application/json" });

      expect(second.etag).not.toBe(first.etag);
      expect<unknown>(await readText(store, key)).toEqual({
        kind: "found",
        info: { key, size: 8, etag: second.etag, contentType: "application/json", metadata: {} },
        span: { offset: 0, length: 8 },
        text: "live: v2",
      });
    });
  });
}

function conditionalWrites(label: string, makeStore: StoreFactory): void {
  describe(`${label}: conditional writes`, () => {
    // Drift: these answers are the only lock the product has; a store that writes on a failed condition loses a publish silently.
    test.each([
      ["absent, on an empty key", false, (): WriteCondition => ({ kind: "absent" }), "written", "new"],
      ["absent, on a held key", true, (): WriteCondition => ({ kind: "absent" }), "precondition-failed", "old"],
      ["unchanged, with the current etag", true, (held: ObjectInfo): WriteCondition => ({ kind: "unchanged", etag: held.etag }), "written", "new"],
      ["unchanged, on an empty key", false, (held: ObjectInfo): WriteCondition => ({ kind: "unchanged", etag: held.etag }), "precondition-failed", undefined],
    ] as const)("%s", async (_name, held, condition, outcome, stored) => {
      const store = await makeStore();
      const key = objectKey("sites/blog/record");
      const elsewhere = await store.write(objectKey("sites/docs/record"), bytesOf("other"), TEXT);
      if (held) await store.write(key, bytesOf("old"), TEXT);

      const current = await store.head(key);
      const known = current.kind === "found" ? current.info : elsewhere;
      const result = await store.writeIf(key, bytesOf("new"), TEXT, condition(known));
      const after = await store.read(key);

      expect(result.kind).toBe(outcome);
      expect(after.kind === "found" ? await new Response(after.body).text() : undefined).toBe(stored);
    });

    test("an etag from before a rewrite no longer passes, and the rewrite survives the refused write", async () => {
      const store = await makeStore();
      const key = objectKey("sites/blog/record");
      const first = await store.write(key, bytesOf("live: v1"), TEXT);
      const second = await store.write(key, bytesOf("live: v2"), TEXT);
      const result = await store.writeIf(key, bytesOf("live: v3"), TEXT, { kind: "unchanged", etag: first.etag });

      expect<unknown>([result, await readText(store, key)]).toEqual([
        { kind: "precondition-failed" },
        { kind: "found", info: second, span: { offset: 0, length: 8 }, text: "live: v2" },
      ]);
    });

    // Drift: two agents publishing the same site at once must not both believe they won.
    test.each([
      ["on the same etag", true],
      ["on an absent key", false],
    ] as const)("two writers racing %s: exactly one is written, and the key holds the winner's bytes", async (_name, held) => {
      const store = await makeStore();
      const key = objectKey("sites/blog/record");
      let condition: WriteCondition = { kind: "absent" };
      if (held) condition = { kind: "unchanged", etag: (await store.write(key, bytesOf("start"), TEXT)).etag };

      const writers = ["first", "second"] as const;
      const results = await Promise.all(writers.map((writer) => store.writeIf(key, bytesOf(writer), TEXT, condition)));
      const winner = writers[results.findIndex((result) => result.kind === "written")];
      const after = await store.read(key);

      expect(results.map((result) => result.kind).sort()).toEqual(["precondition-failed", "written"]);
      expect(after.kind === "found" ? await new Response(after.body).text() : undefined).toBe(winner);
    });
  });
}

function rangedAndConditionalReads(label: string, makeStore: StoreFactory): void {
  describe(`${label}: ranged and conditional reads`, () => {
    // Drift: a browser resuming a download or seeking a video sends these; an off-by-one here corrupts the file it assembles.
    test.each([
      ["the first byte", { offset: 0, length: 1 }, { offset: 0, length: 1 }, "0"],
      ["the last byte", { offset: 9, length: 1 }, { offset: 9, length: 1 }, "9"],
      ["an open end", { offset: 7 }, { offset: 7, length: 3 }, "789"],
      ["a length past the end", { offset: 8, length: 50 }, { offset: 8, length: 2 }, "89"],
      ["a suffix", { suffix: 3 }, { offset: 7, length: 3 }, "789"],
      ["a suffix longer than the object", { suffix: 50 }, { offset: 0, length: 10 }, DIGITS],
    ] as ReadonlyArray<readonly [string, ByteRange, unknown, string]>)("%s returns exactly its bytes and says which", async (_name, range, span, text) => {
      const store = await makeStore();
      const key = objectKey("sites/blog/v1/data.txt");
      const info = await store.write(key, bytesOf(DIGITS), TEXT);

      expect<unknown>(await readText(store, key, { range })).toEqual({ kind: "found", info, span, text });
    });

    test.each([
      ["an offset at the end", { offset: 10 }],
      ["an offset past the end", { offset: 11, length: 1 }],
      ["an empty suffix", { suffix: 0 }],
    ] as ReadonlyArray<readonly [string, ByteRange]>)("%s is not satisfiable and reports the size a 416 needs", async (_name, range) => {
      const store = await makeStore();
      const key = objectKey("sites/blog/v1/data.txt");
      const info = await store.write(key, bytesOf(DIGITS), TEXT);

      expect<unknown>(await store.read(key, { range })).toEqual({ kind: "range-not-satisfiable", info });
    });

    // Drift: a 304 saves the body; answering it for a stale etag would pin a visitor to an old version of the site.
    test.each([
      ["the current etag", (info: ObjectInfo): ReadOptions => ({ ifNoneMatch: info.etag }), "not-modified"],
      ["the current etag, even with an unsatisfiable range", (info: ObjectInfo): ReadOptions => ({ ifNoneMatch: info.etag, range: { offset: 99 } }), "not-modified"],
      ["another etag", (): ReadOptions => ({ ifNoneMatch: STALE_ETAG }), "found"],
    ] as const)("a read with if-none-match on %s", async (_name, options, kind) => {
      const store = await makeStore();
      const key = objectKey("sites/blog/v1/data.txt");
      const info = await store.write(key, bytesOf(DIGITS), TEXT);
      const outcomes = { "not-modified": { kind: "not-modified", info }, found: { kind: "found", info, span: { offset: 0, length: 10 }, text: DIGITS } };

      expect<unknown>(await readText(store, key, options(info))).toEqual(outcomes[kind]);
    });
  });
}

function listing(label: string, makeStore: StoreFactory): void {
  describe(`${label}: listing`, () => {
    // Drift: the storage cap and the trash sweep walk pages; a key skipped or repeated at a page edge miscounts or leaks files.
    test.each([1, 2, 3, 4, MAX_LIST_LIMIT])("pages of %d visit every key under the prefix exactly once, in UTF-8 byte order", async (limit) => {
      const store = await makeStore();
      await seed(store, LISTED_KEYS);

      const pages = await listEveryPage(store, { prefix: "sites/", limit });

      expect(keysOf(pages)).toEqual(LISTED_KEYS.slice(1, 8));
      expect(foldersOf(pages)).toEqual([]);
      expect(pages.every((page) => page.objects.length <= limit)).toBe(true);
    });

    test("a listing carries each object's size and etag, and an empty prefix lists the whole store", async () => {
      const store = await makeStore();
      const settings = await store.write(objectKey(".settings"), bytesOf("{}"), TEXT);
      const readme = await store.write(objectKey("sites/readme"), bytesOf("hello"), TEXT);

      expect<unknown>((await listEveryPage(store, { prefix: "" })).flatMap((page) => page.objects)).toEqual([
        { key: ".settings", size: 2, etag: settings.etag },
        { key: "sites/readme", size: 5, etag: readme.etag },
      ]);
    });

    // Drift: the index page lists sites this way; walking every file of every site instead would cost a request per thousand files.
    test.each([
      ["a folder of sites", "sites/", [["sites/readme", "sites/\uff5e", "sites/\u{1f600}"], ["sites/blog/", "sites/docs/"]]],
      ["one site", "sites/blog/", [["sites/blog/record"], ["sites/blog/v1/", "sites/blog/v2/"]]],
      ["the whole store", "", [[".settings", "sitesmap"], ["sites/"]]],
      ["a prefix that ends inside a segment", "sites/b", [[], ["sites/blog/"]]],
      ["a prefix nothing starts with", "trash/", [[], []]],
    ] as ReadonlyArray<readonly [string, string, readonly [readonly string[], readonly string[]]]>)("the children of %s are its own objects and one folder per deeper level", async (_name, prefix, [objects, folders]) => {
      const store = await makeStore();
      await seed(store, LISTED_KEYS);

      const pages = await listEveryPage(store, { prefix, scope: "children" });

      expect(keysOf(pages)).toEqual([...objects]);
      expect(foldersOf(pages)).toEqual([...folders]);
    });

    test("children paged one entry at a time report each object and each folder exactly once", async () => {
      const store = await makeStore();
      await seed(store, LISTED_KEYS);

      const pages = await listEveryPage(store, { prefix: "sites/", scope: "children", limit: 1 });

      expect(keysOf(pages)).toEqual(["sites/readme", "sites/\uff5e", "sites/\u{1f600}"]);
      expect(foldersOf(pages)).toEqual(["sites/blog/", "sites/docs/"]);
      expect(pages.every((page) => page.objects.length + page.folders.length <= 1)).toBe(true);
    });

    test.each([0, -1, 1.5, MAX_LIST_LIMIT + 1, Number.NaN])("a limit of %d is refused before anything is listed, as R2 would refuse it", async (limit) => {
      const store = await makeStore();

      await expect(store.list({ prefix: "", limit })).rejects.toBeInstanceOf(RangeError);
    });
  });
}

function deleting(label: string, makeStore: StoreFactory): void {
  describe(`${label}: deleting`, () => {
    test("deleting a key that holds nothing is not an error, and deleting one that does leaves its neighbours", async () => {
      const store = await makeStore();
      await seed(store, ["sites/blog/record", "sites/blog/v1/index.html"]);

      await store.delete(objectKey("sites/docs/record"));
      await store.delete(objectKey("sites/blog/record"));

      expect(keysOf(await listEveryPage(store, { prefix: "" }))).toEqual(["sites/blog/v1/index.html"]);
    });

    // Drift: R2 and S3 take 1000 keys per delete call; emptying a large site must not stop there or fail on a key already gone.
    test("delete-many removes more keys than one store call takes, skips a missing one, and touches nothing else", async () => {
      const store = await makeStore();
      const doomed = Array.from({ length: MAX_LIST_LIMIT + 1 }, (_unused, at) => `sites/blog/v1/file-${at}`);
      await seed(store, [...doomed, "sites/blog/record"]);

      await store.deleteMany([...doomed, "sites/blog/v1/never-written"].map(objectKey));
      await store.deleteMany([]);

      expect(keysOf(await listEveryPage(store, { prefix: "" }))).toEqual(["sites/blog/record"]);
    });
  });
}

/**
 * Register the contract every `ObjectStore` keeps. Each implementation's test file calls it with its own factory.
 *
 * @param makeStore - returns an empty store, called once per case
 */
export function describeObjectStore(label: string, makeStore: StoreFactory): void {
  readingAndWriting(label, makeStore);
  conditionalWrites(label, makeStore);
  rangedAndConditionalReads(label, makeStore);
  listing(label, makeStore);
  deleting(label, makeStore);
}
