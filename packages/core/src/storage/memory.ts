// An object store held in memory: the test double every core test runs against, behaving as the store contract says.

import {
  type ByteSpan,
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
  type ReadOptions,
  type ReadResult,
  resolveRange,
  type WriteBody,
  type WriteOptions,
} from "./storage";

const UTF8 = new TextEncoder();

interface StoredObject {
  readonly info: ObjectInfo;
  readonly bytes: Uint8Array;
}

// A listing ascends by the UTF-8 bytes of its keys. The loop stands in for Node's `Buffer.compare`: core runs in a Worker, which has only Web-standard APIs.
function compareNames(left: string, right: string): number {
  const leftBytes = UTF8.encode(left);
  const rightBytes = UTF8.encode(right);
  const shared = Math.min(leftBytes.length, rightBytes.length);

  for (let at = 0; at < shared; at += 1) {
    const difference = (leftBytes[at] ?? 0) - (rightBytes[at] ?? 0);
    if (difference !== 0) return difference;
  }

  return leftBytes.length - rightBytes.length;
}

async function bufferBody(body: WriteBody): Promise<Uint8Array> {
  // A copy by construction: `slice` on a runtime's Buffer subclass shares the caller's memory.
  if (body instanceof Uint8Array) return new Uint8Array(body);

  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));

  // The size is read before the wait: a stream's length is fixed when the call begins.
  const { stream, size } = body;
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (bytes.length !== size) throw new Error(`the stream held ${bytes.length} bytes, not the ${size} it declared`);

  return bytes;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      if (bytes.length > 0) controller.enqueue(bytes);

      controller.close();
    },
  });
}

function summaryOf(stored: StoredObject): ObjectSummary {
  const { key, size, etag } = stored.info;

  return { key, size, etag };
}

/**
 * An `ObjectStore` that keeps its objects in this instance and loses them with it.
 *
 * It differs from a store that hashes the content in one stated way: every write gets a fresh etag, equal bytes included.
 *
 * A list cursor is the last key of its page.
 */
export class MemoryStore implements ObjectStore {
  readonly #objects = new Map<ObjectKey, StoredObject>();

  #writes = 0;

  /** Read what the store keeps about an object, without its bytes. */
  async head(key: ObjectKey): Promise<HeadResult> {
    const stored = this.#objects.get(key);
    if (stored === undefined) return { kind: "missing" };

    return { kind: "found", info: stored.info };
  }

  /** Read an object or a range of it; the body is a copy, so a later write never changes bytes already handed out. */
  async read(key: ObjectKey, options: ReadOptions = {}): Promise<ReadResult> {
    const stored = this.#objects.get(key);
    if (stored === undefined) return { kind: "missing" };

    const { info } = stored;
    if (options.ifNoneMatch === info.etag) return { kind: "not-modified", info };

    let span: ByteSpan | "unsatisfiable" = { offset: 0, length: info.size };
    if (options.range !== undefined) span = resolveRange(options.range, info.size);

    if (span === "unsatisfiable") return { kind: "range-not-satisfiable", info };

    const bytes = stored.bytes.slice(span.offset, span.offset + span.length);

    return { kind: "found", info, span, body: streamOf(bytes) };
  }

  /**
   * Store an object, replacing whatever the key held.
   *
   * @throws {Error} a stream body ended at another length than its `size`; nothing was stored
   * @throws {TypeError} `checkWriteOptions` refused the options; nothing was stored
   */
  async write(key: ObjectKey, body: WriteBody, options: WriteOptions): Promise<ObjectInfo> {
    const { contentType } = checkWriteOptions(options);
    const bytes = await bufferBody(body);
    this.#writes += 1;

    // Frozen, so the one object can be handed to every reader.
    const info: ObjectInfo = Object.freeze({ key, size: bytes.length, etag: `memory-${this.#writes}` as Etag, contentType });
    this.#objects.set(key, { info, bytes });

    return info;
  }

  /** Remove an object. A key that holds none is not an error. */
  async delete(key: ObjectKey): Promise<void> {
    this.#objects.delete(key);
  }

  /** Remove any number of objects. Keys that hold none are skipped. */
  async deleteMany(keys: readonly ObjectKey[]): Promise<void> {
    for (const key of keys) this.#objects.delete(key);
  }

  /**
   * List one page of the keys that start with a prefix, always as many as the limit allows.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to `MAX_LIST_LIMIT`
   * @throws {TypeError} `prefix` holds a lone surrogate or is not in NFC
   */
  async list(options: ListOptions): Promise<ListPage> {
    const limit = checkListOptions(options);
    const { prefix, cursor } = options;
    const listed = [...this.#objects.values()]
      .filter((stored) => stored.info.key.startsWith(prefix))
      .filter((stored) => cursor === undefined || compareNames(stored.info.key, cursor) > 0)
      .sort((left, right) => compareNames(left.info.key, right.info.key));

    const objects = listed.slice(0, limit).map(summaryOf);
    const last = objects.at(-1);
    if (last === undefined || listed.length <= limit) return { objects, more: false };

    return { objects, more: true, cursor: last.key as string as ListCursor };
  }
}
