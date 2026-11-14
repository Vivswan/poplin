// An object store held in memory: the test double every core test runs against, behaving as the R2 one does.

import {
  type ByteSpan,
  type Etag,
  type HeadResult,
  type ListCursor,
  type ListOptions,
  type ListPage,
  MAX_LIST_LIMIT,
  type ObjectInfo,
  type ObjectKey,
  type ObjectStore,
  type ObjectSummary,
  type ReadOptions,
  type ReadResult,
  resolveRange,
  type WriteBody,
  type WriteCondition,
  type WriteOptions,
  type WriteResult,
} from "./storage";

const KEY_SEPARATOR = "/";

interface StoredObject {
  readonly info: ObjectInfo;
  readonly bytes: Uint8Array;
}

type ListEntry = { readonly kind: "object"; readonly name: string; readonly summary: ObjectSummary } | { readonly kind: "folder"; readonly name: string };

// UTF-8 byte order is code point order; the default string order compares UTF-16 units and puts astral characters first.
function compareNames(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const shared = Math.min(leftPoints.length, rightPoints.length);

  for (let at = 0; at < shared; at += 1) {
    const difference = (leftPoints[at] ?? 0) - (rightPoints[at] ?? 0);
    if (difference !== 0) return difference;
  }

  return leftPoints.length - rightPoints.length;
}

async function bufferBody(body: WriteBody): Promise<Uint8Array> {
  // A copy by construction: `slice` on a runtime's Buffer subclass shares the caller's memory.
  if (body instanceof Uint8Array) return new Uint8Array(body);

  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));

  const bytes = new Uint8Array(await new Response(body.stream).arrayBuffer());
  if (bytes.length !== body.size) throw new Error(`the stream held ${bytes.length} bytes, not the ${body.size} it declared`);

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

function copyOf(info: ObjectInfo): ObjectInfo {
  return { ...info, metadata: { ...info.metadata } };
}

function conditionHolds(condition: WriteCondition, current: StoredObject | undefined): boolean {
  if (condition.kind === "absent") return current === undefined;

  return current !== undefined && current.info.etag === condition.etag;
}

function pageLimit(options: ListOptions): number {
  const limit = options.limit ?? MAX_LIST_LIMIT;
  const valid = Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIST_LIMIT;

  if (!valid) throw new RangeError(`a list limit is a whole number from 1 to ${MAX_LIST_LIMIT}, not ${limit}`);

  return limit;
}

function entryFor(stored: StoredObject, options: ListOptions): ListEntry {
  const { key, size, etag } = stored.info;
  const object: ListEntry = { kind: "object", name: key, summary: { key, size, etag } };

  if (options.scope !== "children") return object;

  const separatorAt = key.indexOf(KEY_SEPARATOR, options.prefix.length);
  if (separatorAt === -1) return object;

  return { kind: "folder", name: key.slice(0, separatorAt + KEY_SEPARATOR.length) };
}

function pageOf(entries: readonly ListEntry[], limit: number): ListPage {
  const shown = entries.slice(0, limit);
  const objects: ObjectSummary[] = [];
  const folders: string[] = [];

  for (const entry of shown) {
    if (entry.kind === "folder") folders.push(entry.name);
    if (entry.kind === "object") objects.push(entry.summary);
  }

  const last = shown.at(-1);
  if (last === undefined || entries.length <= limit) return { objects, folders, more: false };

  return { objects, folders, more: true, cursor: last.name as ListCursor };
}

/**
 * An `ObjectStore` that keeps its objects in this instance and loses them with it.
 *
 * It differs from R2 in one stated way: every write gets a fresh etag, equal bytes included. A list cursor is the last name of its page.
 */
export class MemoryStore implements ObjectStore {
  readonly #objects = new Map<ObjectKey, StoredObject>();

  #writes = 0;

  #store(key: ObjectKey, bytes: Uint8Array, options: WriteOptions): ObjectInfo {
    this.#writes += 1;

    const info: ObjectInfo = {
      key,
      size: bytes.length,
      etag: `memory-${this.#writes}` as Etag,
      contentType: options.contentType,
      metadata: { ...options.metadata },
    };
    this.#objects.set(key, { info, bytes });

    return copyOf(info);
  }

  /** Read an object's metadata without its bytes. */
  async head(key: ObjectKey): Promise<HeadResult> {
    const stored = this.#objects.get(key);
    if (stored === undefined) return { kind: "missing" };

    return { kind: "found", info: copyOf(stored.info) };
  }

  /** Read an object or a range of it; the body is a copy, so a later write never changes bytes already handed out. */
  async read(key: ObjectKey, options: ReadOptions = {}): Promise<ReadResult> {
    const stored = this.#objects.get(key);
    if (stored === undefined) return { kind: "missing" };

    const info = copyOf(stored.info);
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
   */
  async write(key: ObjectKey, body: WriteBody, options: WriteOptions): Promise<ObjectInfo> {
    const bytes = await bufferBody(body);

    return this.#store(key, bytes, options);
  }

  /**
   * Store an object only while `condition` holds; the check and the store share one turn, so racing writers cannot both pass.
   *
   * @throws {Error} a stream body ended at another length than its `size`; nothing was stored
   */
  async writeIf(key: ObjectKey, body: WriteBody, options: WriteOptions, condition: WriteCondition): Promise<WriteResult> {
    const bytes = await bufferBody(body);

    if (!conditionHolds(condition, this.#objects.get(key))) return { kind: "precondition-failed" };

    return { kind: "written", info: this.#store(key, bytes, options) };
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
   */
  async list(options: ListOptions): Promise<ListPage> {
    const limit = pageLimit(options);
    const entries = new Map<string, ListEntry>();

    for (const stored of this.#objects.values()) {
      if (!stored.info.key.startsWith(options.prefix)) continue;

      const entry = entryFor(stored, options);
      entries.set(entry.name, entry);
    }

    const { cursor } = options;
    const ordered = [...entries.values()].sort((left, right) => compareNames(left.name, right.name));
    if (cursor === undefined) return pageOf(ordered, limit);

    return pageOf(
      ordered.filter((entry) => compareNames(entry.name, cursor) > 0),
      limit,
    );
  }
}
