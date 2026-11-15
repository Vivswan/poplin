// Core's object store on an R2 bucket binding.
// R2 lists at most 1000 keys a call and takes a key of up to 1024 bytes: core's list limit and its longest key stay inside both.

import {
  type ByteRange,
  checkListOptions,
  checkWriteOptions,
  type Etag,
  type HeadResult,
  type ListCursor,
  type ListOptions,
  type ListPage,
  type ObjectInfo,
  type ObjectKey,
  type ObjectStore,
  type ObjectSummary,
  parseObjectKey,
  type ReadOptions,
  type ReadResult,
  resolveRange,
  type WriteBody,
  type WriteOptions,
} from "@poplin/core/src/storage/storage";

/** The most keys one R2 delete call takes. */
const DELETE_BATCH = 1000;

/** The type HTTP gives bytes of unknown type; it stands in for an object stored without one. */
const UNTYPED = "application/octet-stream";

/** The characters of an etag R2 issues. R2 reads `*` as "any object" and throws on a quote, so a visitor's string with other characters is never sent. */
const R2_ETAG = /^[\w-]+$/;

// R2 normalises a key to NFC and stores a lone surrogate as U+FFFD: core refuses both, so a key is listed as it was written.
function listedKey(raw: string): ObjectKey {
  const parsed = parseObjectKey(raw);
  if (!parsed.ok) throw new Error(`the bucket holds a key this store could not have written (${parsed.refusal}): ${JSON.stringify(raw)}`);

  return parsed.key;
}

function summaryOf(object: R2Object): ObjectSummary {
  return { key: listedKey(object.key), size: object.size, etag: object.etag as Etag };
}

function infoOf(key: ObjectKey, object: R2Object): ObjectInfo {
  return { key, size: object.size, etag: object.etag as Etag, contentType: object.httpMetadata?.contentType ?? UNTYPED };
}

// R2 refuses a stream of unknown length; a fixed-length one also fails the put when the stream ends at another length.
function putBody(body: WriteBody): ReadableStream | ArrayBuffer | Uint8Array {
  if (body instanceof Uint8Array || body instanceof ArrayBuffer) return body;

  // A fixed-length stream rounds a fraction down, and would store the stream it then matches.
  if (!Number.isSafeInteger(body.size)) throw new Error(`a stream's size is a whole number of bytes, not ${body.size}`);

  return body.stream.pipeThrough(new FixedLengthStream(body.size));
}

function listOptions(options: ListOptions): R2ListOptions {
  const listed: R2ListOptions = { prefix: options.prefix, limit: checkListOptions(options) };

  if (options.cursor !== undefined) listed.cursor = options.cursor;

  return listed;
}

/**
 * An `ObjectStore` on an R2 bucket binding. The bucket is this store's alone: a listing rejects on a key the key rules refuse.
 *
 * An etag is R2's own, a hash of the bytes, so a rewrite of the same bytes keeps it.
 */
export class R2Store implements ObjectStore {
  readonly #bucket: R2Bucket;

  constructor(bucket: R2Bucket) {
    this.#bucket = bucket;
  }

  async #readWhole(key: ObjectKey, ifNoneMatch: string | undefined): Promise<ReadResult> {
    const options: R2GetOptions = {};
    if (ifNoneMatch !== undefined && R2_ETAG.test(ifNoneMatch)) options.onlyIf = { etagDoesNotMatch: ifNoneMatch };

    const object = await this.#bucket.get(key, options);
    if (object === null) return { kind: "missing" };

    const info = infoOf(key, object);
    if (!("body" in object)) return { kind: "not-modified", info };

    return { kind: "found", info, span: { offset: 0, length: info.size }, body: object.body };
  }

  // R2 throws on an offset past the end, so the size is read first and the range decided here.
  async #readRange(key: ObjectKey, range: ByteRange, ifNoneMatch: string | undefined): Promise<ReadResult> {
    const head = await this.#bucket.head(key);
    if (head === null) return { kind: "missing" };

    const info = infoOf(key, head);
    if (ifNoneMatch === info.etag) return { kind: "not-modified", info };

    const span = resolveRange(range, info.size);
    if (span === "unsatisfiable") return { kind: "range-not-satisfiable", info };

    const object = await this.#bucket.get(key, { range: span, onlyIf: { etagMatches: info.etag } });

    // A write landed between the two calls, and the span was worked out for the object it replaced.
    if (object === null || !("body" in object)) return this.#readRange(key, range, ifNoneMatch);

    return { kind: "found", info: infoOf(key, object), span, body: object.body };
  }

  /** Read what the store keeps about an object, without its bytes. */
  async head(key: ObjectKey): Promise<HeadResult> {
    const object = await this.#bucket.head(key);
    if (object === null) return { kind: "missing" };

    return { kind: "found", info: infoOf(key, object) };
  }

  /** Read an object or a range of it. A ranged read costs two R2 calls, a whole one a single call. */
  async read(key: ObjectKey, options: ReadOptions = {}): Promise<ReadResult> {
    if (options.range === undefined) return this.#readWhole(key, options.ifNoneMatch);

    return this.#readRange(key, options.range, options.ifNoneMatch);
  }

  /**
   * Store an object, replacing whatever the key held.
   *
   * @throws {Error} a stream body ended at another length than its `size`; nothing was stored
   * @throws {TypeError} `checkWriteOptions` refused the options; nothing was stored
   */
  async write(key: ObjectKey, body: WriteBody, options: WriteOptions): Promise<ObjectInfo> {
    const { contentType } = checkWriteOptions(options);
    const object = await this.#bucket.put(key, putBody(body), { httpMetadata: { contentType } });

    return infoOf(key, object);
  }

  /** Remove an object. A key that holds none is not an error. */
  async delete(key: ObjectKey): Promise<void> {
    await this.#bucket.delete(key);
  }

  /** Remove any number of objects, a thousand per R2 call. Keys that hold none are skipped, and a rejection may leave some removed. */
  async deleteMany(keys: readonly ObjectKey[]): Promise<void> {
    for (let at = 0; at < keys.length; at += DELETE_BATCH) await this.#bucket.delete(keys.slice(at, at + DELETE_BATCH));
  }

  /**
   * List one page of the keys that start with a prefix. A page may hold fewer objects than the limit while more remain.
   *
   * R2's reference calls its order lexicographic. The contract suite holds it to UTF-8 byte order with keys the two UTF orders sort apart.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to `MAX_LIST_LIMIT`
   * @throws {TypeError} `prefix` holds a lone surrogate or is not in NFC
   * @throws {Error} the bucket holds a key the key rules refuse
   */
  async list(options: ListOptions): Promise<ListPage> {
    const listed = await this.#bucket.list(listOptions(options));
    const objects = listed.objects.map(summaryOf);

    if (!listed.truncated) return { objects, more: false };

    return { objects, more: true, cursor: listed.cursor as ListCursor };
  }
}
