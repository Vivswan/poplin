// An object store in memory whose whole content can be handed out and put back, so a host that is stopped at any moment goes on where it was.

import {
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
  type ReadOptions,
  type ReadResult,
  resolveRange,
  type WriteBody,
  type WriteOptions,
} from "../../../core/src/storage/storage";

const UTF8 = new TextEncoder();

/** One object as it is kept and saved. */
interface KeptObject {
  readonly info: ObjectInfo;
  readonly bytes: Uint8Array;
}

/** Everything a `KeptStore` holds, as `save` hands it out. */
export interface SavedStore {
  /** Every object, in no order. */
  readonly objects: readonly KeptObject[];

  /** How many writes the store has taken: the next etag follows from it, so no etag is ever given twice. */
  readonly writes: number;
}

/** A listing ascends by the UTF-8 bytes of its keys, which is not the order of a string comparison. */
function compareKeys(left: string, right: string): number {
  const leftBytes = UTF8.encode(left);
  const rightBytes = UTF8.encode(right);
  const shared = Math.min(leftBytes.length, rightBytes.length);

  for (let at = 0; at < shared; at += 1) {
    const difference = (leftBytes[at] ?? 0) - (rightBytes[at] ?? 0);
    if (difference !== 0) return difference;
  }

  return leftBytes.length - rightBytes.length;
}

async function bytesOf(body: WriteBody): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return new Uint8Array(body);

  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));

  const { stream, size } = body;
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (bytes.length !== size) throw new Error(`the stream held ${bytes.length} bytes, not the ${size} it declared`);

  return bytes;
}

/**
 * An `ObjectStore` in memory that outlives its host: `save` hands out all it holds, and a new store takes that back.
 *
 * An etag stays the same across a save, since a browser may hold a copy under it. Every write gets a fresh one, equal bytes included.
 *
 * A list cursor is the last key of its page.
 */
export class KeptStore implements ObjectStore {
  readonly #objects = new Map<ObjectKey, KeptObject>();

  #writes: number;

  /** @param saved - what `save` handed out earlier; an empty store when left out */
  constructor(saved: SavedStore = { objects: [], writes: 0 }) {
    for (const object of saved.objects) this.#objects.set(object.info.key, object);

    this.#writes = saved.writes;
  }

  /**
   * Hand out everything the store holds now.
   *
   * @returns the objects and the count of writes; the bytes are the store's own, which no later write changes
   */
  save(): SavedStore {
    return { objects: [...this.#objects.values()], writes: this.#writes };
  }

  async head(key: ObjectKey): Promise<HeadResult> {
    const kept = this.#objects.get(key);
    if (kept === undefined) return { kind: "missing" };

    return { kind: "found", info: kept.info };
  }

  async read(key: ObjectKey, options: ReadOptions = {}): Promise<ReadResult> {
    const kept = this.#objects.get(key);
    if (kept === undefined) return { kind: "missing" };

    const { info } = kept;
    if (options.ifNoneMatch === info.etag) return { kind: "not-modified", info };

    const span = options.range === undefined ? { offset: 0, length: info.size } : resolveRange(options.range, info.size);
    if (span === "unsatisfiable") return { kind: "range-not-satisfiable", info };

    const bytes = kept.bytes.slice(span.offset, span.offset + span.length);

    return { kind: "found", info, span, body: new Blob([bytes]).stream() };
  }

  async write(key: ObjectKey, body: WriteBody, options: WriteOptions): Promise<ObjectInfo> {
    const { contentType } = checkWriteOptions(options);
    const bytes = await bytesOf(body);
    this.#writes += 1;

    const info: ObjectInfo = Object.freeze({ key, size: bytes.length, etag: `kept-${this.#writes}` as Etag, contentType });
    this.#objects.set(key, { info, bytes });

    return info;
  }

  async delete(key: ObjectKey): Promise<void> {
    this.#objects.delete(key);
  }

  async deleteMany(keys: readonly ObjectKey[]): Promise<void> {
    for (const key of keys) this.#objects.delete(key);
  }

  async list(options: ListOptions): Promise<ListPage> {
    const limit = checkListOptions(options);
    const { prefix, cursor } = options;
    const listed = [...this.#objects.values()]
      .map((kept) => kept.info)
      .filter((info) => info.key.startsWith(prefix) && (cursor === undefined || compareKeys(info.key, cursor) > 0))
      .sort((left, right) => compareKeys(left.key, right.key));

    const objects = listed.slice(0, limit).map(({ key, size, etag }) => ({ key, size, etag }));
    const last = objects.at(-1);
    if (last === undefined || listed.length <= limit) return { objects, more: false };

    return { objects, more: true, cursor: last.key as string as ListCursor };
  }
}
