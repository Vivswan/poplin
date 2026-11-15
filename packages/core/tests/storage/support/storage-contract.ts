// The contract every `ObjectStore` keeps, as test cases that take a store factory. Importing this file registers nothing.

import { describe, expect, test } from "bun:test";

import {
  type ByteRange,
  deletePrefix,
  type ListOptions,
  type ListPage,
  MAX_LIST_LIMIT,
  type ObjectInfo,
  type ObjectKey,
  type ObjectStore,
  parseObjectKey,
  type ReadOptions,
} from "../../../src/storage/storage";

/** The options of a write whose content type the case does not look at. */
const TEXT = { contentType: "text/plain" } as const;

/** Ten bytes, each naming its own offset, so a ranged read shows which bytes came back. */
const DIGITS = "0123456789";

/** An etag in no store's form, standing for a visitor's stale copy. */
const STALE_ETAG = "an-etag-no-store-issued";

/** Two neighbours around the seven files of `blog/`. U+FF5E sorts before U+1F600 in UTF-8 bytes and after it in UTF-16 units. */
const LISTED_KEYS = [
  "art/v1/index.html",
  "blog/v1/index.html",
  "blog/v1/notes/a.txt",
  "blog/v1/\uff5e",
  "blog/v1/\u{1f600}",
  "blog/v2/index.html",
  "blog/v2/style.css",
  "blog/v3/index.html",
  "blog2/v1/index.html",
] as const;

/** Half a surrogate pair: no UTF-8 holds it, so a store would keep another character in its place. */
const LONE_SURROGATE = "\ud83d";

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
async function listEveryPage(store: ObjectStore, options: Omit<ListOptions, "cursor">, afterFirstPage?: () => Promise<unknown>): Promise<ListPage[]> {
  const pages: ListPage[] = [];
  let page = await store.list(options);
  await afterFirstPage?.();

  while (true) {
    pages.push(page);
    if (!page.more) return pages;

    page = await store.list({ ...options, cursor: page.cursor });
  }
}

function keysOf(pages: readonly ListPage[]): string[] {
  return pages.flatMap((page) => page.objects.map((object) => object.key));
}

function readingAndWriting(label: string, makeStore: StoreFactory): void {
  describe(`${label}: reading and writing`, () => {
    test("a key nothing was written to answers missing from head and read, so a first publish never needs a catch", async () => {
      const store = await makeStore();
      const key = objectKey("blog/v1/index.html");

      expect<unknown>([await store.head(key), await store.read(key)]).toEqual([{ kind: "missing" }, { kind: "missing" }]);
    });

    // Drift: a page is its bytes and its content type; a store that drops the type serves a site as a download.
    test.each([
      ["a buffer", (): Uint8Array => bytesOf("<h1>hi</h1>")],
      ["an ArrayBuffer", (): ArrayBuffer => bytesOf("<h1>hi</h1>").buffer as ArrayBuffer],
      ["a sized stream", (): { stream: ReadableStream<Uint8Array>; size: number } => ({ stream: streamOf("<h1>hi</h1>"), size: 11 })],
    ] as const)("a write from %s reads back whole, with its content type, from head and read", async (_form, body) => {
      const store = await makeStore();
      const key = objectKey("blog/v1/index.html");
      const written = await store.write(key, body(), { contentType: "text/html; charset=utf-8" });
      const info = { key, size: 11, etag: written.etag, contentType: "text/html; charset=utf-8" };

      expect<unknown>([written, await store.head(key), await readText(store, key)]).toEqual([
        { ...info, etag: expect.any(String) },
        { kind: "found", info },
        { kind: "found", info, span: { offset: 0, length: 11 }, text: "<h1>hi</h1>" },
      ]);
    });

    test("an empty object reads back as an empty body, not as missing", async () => {
      const store = await makeStore();
      const key = objectKey("blog/v1/empty.css");
      const written = await store.write(key, new Uint8Array(0), { contentType: "text/css" });

      expect<unknown>(await readText(store, key)).toEqual({
        kind: "found",
        info: { key, size: 0, etag: written.etag, contentType: "text/css" },
        span: { offset: 0, length: 0 },
        text: "",
      });
    });

    test("a stream that ends short of its declared size rejects and stores nothing, so a cut upload never becomes a site file", async () => {
      const store = await makeStore();
      const key = objectKey("blog/v1/app.js");

      await expect(store.write(key, { stream: streamOf("short"), size: 9 }, TEXT)).rejects.toBeInstanceOf(Error);
      expect<unknown>(await store.head(key)).toEqual({ kind: "missing" });
    });

    // Drift: a stream's length is fixed as the call begins; a store that read the size again later would keep a cut upload another store refuses.
    test("a stream held to the size it declared when the write began: a size the caller lowers afterwards does not make a short stream whole", async () => {
      const store = await makeStore();
      const key = objectKey("blog/v1/app.js");
      const body = { stream: streamOf("x"), size: 2 };
      const written = store.write(key, body, TEXT);
      body.size = 1;

      await expect(written).rejects.toBeInstanceOf(Error);
      expect<unknown>(await store.head(key)).toEqual({ kind: "missing" });
    });

    test("a rewrite with other bytes changes the etag and replaces bytes and type together", async () => {
      const store = await makeStore();
      const key = objectKey("blog/v1/data");
      const first = await store.write(key, bytesOf("live: v1"), { contentType: "text/plain" });
      const second = await store.write(key, bytesOf("live: v2"), { contentType: "application/json" });

      expect(second.etag).not.toBe(first.etag);
      expect<unknown>(await readText(store, key)).toEqual({
        kind: "found",
        info: { key, size: 8, etag: second.etag, contentType: "application/json" },
        span: { offset: 0, length: 8 },
        text: "live: v2",
      });
    });

    // Drift: a store may replace a lone surrogate with another character; a store that took one would serve another content type than it was given.
    test("a write whose content type holds a lone surrogate is refused, and stores nothing", async () => {
      const store = await makeStore();
      const key = objectKey("blog/v1/index.html");
      const write = (): Promise<unknown> => store.write(key, bytesOf("<h1>hi</h1>"), { contentType: `text/html${LONE_SURROGATE}` });

      await expect(write()).rejects.toBeInstanceOf(TypeError);
      await expect(write()).rejects.toThrow("lone surrogate");
      expect<unknown>(await store.head(key)).toEqual({ kind: "missing" });
    });

    // Drift: a content type goes out as a header; one with a line break would add a header of the publisher's choosing, and an empty one would leave the browser to guess.
    test.each([
      ["a line break", "text/html\r\nx-added: yes"],
      ["a lone line feed", "text/html\nx-added: yes"],
      ["a null character", "text/\u0000html"],
      ["nothing", ""],
    ])("a write whose content type holds %s is refused, and stores nothing", async (_what, contentType) => {
      const store = await makeStore();
      const key = objectKey("blog/v1/index.html");

      await expect(store.write(key, bytesOf("<h1>hi</h1>"), { contentType })).rejects.toBeInstanceOf(TypeError);
      expect<unknown>(await store.head(key)).toEqual({ kind: "missing" });
    });

    // Drift: a store that checks the options and then reads them again after the body arrives would store what it never checked.
    test("a content type the caller changes while a write is under way is stored as it was when the call began", async () => {
      const store = await makeStore();
      const key = objectKey("blog/v1/index.html");
      const options = { contentType: "text/html" };
      const written = store.write(key, { stream: streamOf("<h1>hi</h1>"), size: 11 }, options);

      options.contentType = `text/html${LONE_SURROGATE}`;
      await written;
      const head = await store.head(key);

      expect(head.kind === "found" ? head.info.contentType : undefined).toBe("text/html");
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
      const key = objectKey("blog/v1/data.txt");
      const info = await store.write(key, bytesOf(DIGITS), TEXT);

      expect<unknown>(await readText(store, key, { range })).toEqual({ kind: "found", info, span, text });
    });

    test.each([
      ["an offset at the end", { offset: 10 }],
      ["an offset past the end", { offset: 11, length: 1 }],
      ["an empty suffix", { suffix: 0 }],
    ] as ReadonlyArray<readonly [string, ByteRange]>)("%s is not satisfiable and reports the size a 416 needs", async (_name, range) => {
      const store = await makeStore();
      const key = objectKey("blog/v1/data.txt");
      const info = await store.write(key, bytesOf(DIGITS), TEXT);

      expect<unknown>(await store.read(key, { range })).toEqual({ kind: "range-not-satisfiable", info });
    });

    // Drift: a 304 saves the body; answering it for a stale etag would pin a visitor to an old version of the site.
    test.each([
      ["the current etag", (info: ObjectInfo): ReadOptions => ({ ifNoneMatch: info.etag }), "not-modified"],
      ["the current etag, with a range the object holds", (info: ObjectInfo): ReadOptions => ({ ifNoneMatch: info.etag, range: { offset: 2, length: 3 } }), "not-modified"],
      ["the current etag, even with an unsatisfiable range", (info: ObjectInfo): ReadOptions => ({ ifNoneMatch: info.etag, range: { offset: 99 } }), "not-modified"],
      ["another etag, with a range the object holds", (): ReadOptions => ({ ifNoneMatch: STALE_ETAG, range: { offset: 2, length: 3 } }), "part"],
      ["another etag", (): ReadOptions => ({ ifNoneMatch: STALE_ETAG }), "found"],
    ] as const)("a read with if-none-match on %s", async (_name, options, kind) => {
      const store = await makeStore();
      const key = objectKey("blog/v1/data.txt");
      const info = await store.write(key, bytesOf(DIGITS), TEXT);
      const outcomes = { "not-modified": { kind: "not-modified", info }, found: { kind: "found", info, span: { offset: 0, length: 10 }, text: DIGITS }, part: { kind: "found", info, span: { offset: 2, length: 3 }, text: "234" } };

      expect<unknown>(await readText(store, key, options(info))).toEqual(outcomes[kind]);
    });
  });
}

function listing(label: string, makeStore: StoreFactory): void {
  describe(`${label}: listing`, () => {
    // Drift: the storage cap and the removal of a site walk pages; a key skipped or repeated at a page edge miscounts or leaks files.
    test.each([1, 2, 3, 4, MAX_LIST_LIMIT])("pages of %d visit every key under the prefix exactly once, in UTF-8 byte order", async (limit) => {
      const store = await makeStore();
      await seed(store, LISTED_KEYS);

      const pages = await listEveryPage(store, { prefix: "blog/", limit });

      expect(keysOf(pages)).toEqual(LISTED_KEYS.slice(1, 8));
      expect(pages.every((page) => page.objects.length <= limit)).toBe(true);
    });

    // Drift: a listing is not a snapshot; a publish landing while the storage cap counts a site must not make it skip or count twice a file nothing touched.
    test("a write under the prefix between two pages: every key no write touched is still listed exactly once", async () => {
      const store = await makeStore();
      await seed(store, LISTED_KEYS);

      const pages = await listEveryPage(store, { prefix: "blog/", limit: 1 }, () => store.write(objectKey("blog/v4/index.html"), bytesOf("later"), TEXT));

      expect(keysOf(pages).filter((key) => key !== "blog/v4/index.html")).toEqual(LISTED_KEYS.slice(1, 8));
    });

    // Drift: a prefix is matched as text, not as a folder; a store that rounded it to a segment would list a site's neighbour or nothing.
    test.each([
      ["ends inside a segment", "blog/v1/n", ["blog/v1/notes/a.txt"]],
      ["nothing starts with", "trash/", []],
    ] as const)("a prefix that %s lists exactly the keys that start with it", async (_name, prefix, keys) => {
      const store = await makeStore();
      await seed(store, LISTED_KEYS);

      expect(keysOf(await listEveryPage(store, { prefix }))).toEqual([...keys]);
    });

    test("a listing carries each object's size and etag, and an empty prefix lists the whole store", async () => {
      const store = await makeStore();
      const style = await store.write(objectKey("art/v1/style.css"), bytesOf("{}"), TEXT);
      const page = await store.write(objectKey("blog/v1/index.html"), bytesOf("hello"), TEXT);

      expect<unknown>((await listEveryPage(store, { prefix: "" })).flatMap((listed) => listed.objects)).toEqual([
        { key: "art/v1/style.css", size: 2, etag: style.etag },
        { key: "blog/v1/index.html", size: 5, etag: page.etag },
      ]);
    });

    // Drift: a store may replace a lone surrogate and normalise to NFC, so such a prefix would list other keys on one store than on another.
    test.each([
      ["a lone surrogate", `blog/${LONE_SURROGATE}`, "lone surrogate"],
      ["text that is not NFC", "blog/cafe\u0301", "NFC"],
    ] as const)("a prefix holding %s is refused before anything is listed", async (_name, prefix, reason) => {
      const store = await makeStore();

      await expect(store.list({ prefix })).rejects.toBeInstanceOf(TypeError);
      await expect(store.list({ prefix })).rejects.toThrow(reason);
    });

    test.each([0, -1, 1.5, MAX_LIST_LIMIT + 1, Number.NaN])("a limit of %d is refused before anything is listed", async (limit) => {
      const store = await makeStore();

      await expect(store.list({ prefix: "", limit })).rejects.toBeInstanceOf(RangeError);
    });
  });
}

function deleting(label: string, makeStore: StoreFactory): void {
  describe(`${label}: deleting`, () => {
    test("deleting a key that holds nothing is not an error, and deleting one that does leaves its neighbours", async () => {
      const store = await makeStore();
      await seed(store, ["blog/v1/index.html", "blog/v1/style.css"]);

      await store.delete(objectKey("art/v1/index.html"));
      await store.delete(objectKey("blog/v1/index.html"));

      expect(keysOf(await listEveryPage(store, { prefix: "" }))).toEqual(["blog/v1/style.css"]);
    });

    // Drift: a store may take only so many keys per delete call; emptying a large site must not stop there or fail on a key already gone.
    test("delete-many removes more keys than one store call takes, skips a missing one, and touches nothing else", async () => {
      const store = await makeStore();
      const doomed = Array.from({ length: MAX_LIST_LIMIT + 1 }, (_unused, at) => `blog/v1/file-${at}`);
      await seed(store, [...doomed, "blog/v2/index.html"]);

      await store.deleteMany([...doomed, "blog/v1/never-written"].map(objectKey));
      await store.deleteMany([]);

      expect(keysOf(await listEveryPage(store, { prefix: "" }))).toEqual(["blog/v2/index.html"]);
    });

    // Drift: removing a site must take every version of it and no file of a site whose name only starts the same way.
    test("delete-prefix removes a folder larger than one page, counts what it removed, and leaves the folders beside it", async () => {
      const store = await makeStore();
      const doomed = Array.from({ length: MAX_LIST_LIMIT + 1 }, (_unused, at) => `blog/v${at}/index.html`);
      const kept = ["art/v1/index.html", "blog2/v1/index.html"];
      await seed(store, [...doomed, ...kept]);

      const outcomes = [await deletePrefix(store, "blog/", 15), await deletePrefix(store, "blog/", 15)];

      expect(outcomes).toEqual([
        { removed: MAX_LIST_LIMIT + 1, more: false },
        { removed: 0, more: false },
      ]);
      expect(keysOf(await listEveryPage(store, { prefix: "" }))).toEqual(kept);
    });

    // Drift: a prefix without its slash also starts the keys of every longer folder name, and an empty one starts every key in the bucket.
    test.each(["blog", ""])("delete-prefix refuses the prefix %j, which is no folder, before anything is removed", async (prefix) => {
      const store = await makeStore();
      await seed(store, ["blog/v1/index.html", "blog2/v1/index.html"]);

      await expect(deletePrefix(store, prefix, 1)).rejects.toBeInstanceOf(TypeError);
      expect(keysOf(await listEveryPage(store, { prefix: "" }))).toEqual(["blog/v1/index.html", "blog2/v1/index.html"]);
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
  rangedAndConditionalReads(label, makeStore);
  listing(label, makeStore);
  deleting(label, makeStore);
}
