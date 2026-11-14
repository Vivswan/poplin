// The object store every product rule reads and writes through, with the key and byte-range rules its implementations share.

/** The most entries one `list` call may ask for; R2 and S3 both stop a page there. */
export const MAX_LIST_LIMIT = 1000;

/** The longest key R2 and S3 both accept, in UTF-8 bytes. */
const MAX_KEY_BYTES = 1024;

/** What joins a key's segments, and what a `children` listing stops at. */
const KEY_SEPARATOR = "/";

/** Segments an S3 client or a URL parser would resolve away. */
const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

/** A control character, which the key rules refuse, or a surrogate left without its pair, which UTF-8 cannot carry. */
const UNSTORABLE_CHARACTER = /[\p{Cc}\p{Cs}]/u;

/** Measures a key as the stores do. */
const UTF8 = new TextEncoder();

declare const objectKeyBrand: unique symbol;
declare const etagBrand: unique symbol;
declare const listCursorBrand: unique symbol;

/**
 * A string that passed `parseObjectKey`; no other code can make one.
 *
 * The rules: 1 to 1024 UTF-8 bytes; segments joined by `/`, none empty (so no leading, trailing, or doubled slash) and none `.` or `..`; no control character and no lone surrogate.
 *
 * A key is also in Unicode NFC: R2 normalises keys to it and would fold two spellings into one object.
 */
export type ObjectKey = string & { readonly [objectKeyBrand]: true };

/**
 * A store's name for the bytes of one object, unquoted. Only a store makes one.
 *
 * It changes whenever a write changes the bytes. A write of the same bytes may keep it (R2 and S3 hash the content), so a record guarded by `writeIf` must differ in bytes on every write.
 */
export type Etag = string & { readonly [etagBrand]: true };

/** Where a listing stopped. It continues only a `list` call with the same prefix and scope, on the store that made it. */
export type ListCursor = string & { readonly [listCursorBrand]: true };

/** Why a string is not an object key. `bad-character` is a control character or a lone surrogate. */
type KeyRefusal = "empty" | "too-long" | "bad-character" | "not-normalized" | "empty-segment" | "dot-segment";

/** A parsed key, or the first rule the string breaks. */
export type CheckedKey = { readonly ok: true; readonly key: ObjectKey } | { readonly ok: false; readonly refusal: KeyRefusal };

/** What a listing tells about an object: enough to count and to guard a later write. */
export interface ObjectSummary {
  /** The whole key, never the part after a listing prefix. */
  readonly key: ObjectKey;

  /** The whole object's length in bytes, also on a ranged read. */
  readonly size: number;

  /** What a later `writeIf` passes to prove the bytes have not changed. */
  readonly etag: Etag;
}

/** Everything a store keeps about an object besides its bytes. */
export interface ObjectInfo extends ObjectSummary {
  /** The media type given at the write, served back as the `Content-Type` header. */
  readonly contentType: string;

  /** The caller's own small string map, returned as written. Stores cap it near 2 KB in total. */
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * The bytes a read asks for, in the three forms an HTTP `Range` header has.
 *
 * `offset` alone runs to the end; `length` is cut at the end; `suffix` is the last so many bytes, the whole object when it has fewer.
 */
export type ByteRange = { readonly offset: number; readonly length?: number } | { readonly suffix: number };

/** The bytes a read returned: `length` bytes starting at `offset`, at least one except for an empty object read whole. */
export interface ByteSpan {
  readonly offset: number;
  readonly length: number;
}

/** How to narrow a read. With both set, `ifNoneMatch` is decided first, as HTTP does. */
export interface ReadOptions {
  /** The part of the object to return; the whole object when absent. */
  readonly range?: ByteRange;

  /** An etag in the store's unquoted form, as a visitor sent it; an equal one answers `not-modified`. */
  readonly ifNoneMatch?: string;
}

/** The answer to `head`. */
export type HeadResult = { readonly kind: "found"; readonly info: ObjectInfo } | { readonly kind: "missing" };

/**
 * The answer to `read`. `body` holds exactly the bytes of `span` and can be consumed once.
 *
 * `range-not-satisfiable` means the range selects no byte of the object; `info.size` is what a 416 reply reports.
 */
export type ReadResult =
  | { readonly kind: "found"; readonly info: ObjectInfo; readonly span: ByteSpan; readonly body: ReadableStream<Uint8Array> }
  | { readonly kind: "not-modified"; readonly info: ObjectInfo }
  | { readonly kind: "range-not-satisfiable"; readonly info: ObjectInfo }
  | { readonly kind: "missing" };

/** The bytes to store. A stream carries its length up front because R2 and S3 refuse one of unknown length. */
export type WriteBody = Uint8Array | ArrayBuffer | { readonly stream: ReadableStream<Uint8Array>; readonly size: number };

/** What is stored beside the bytes. An absent `metadata` stores an empty map. */
export interface WriteOptions {
  readonly contentType: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** What must still be true of the key at the moment the write lands: no object there, or the object this etag names. */
export type WriteCondition = { readonly kind: "absent" } | { readonly kind: "unchanged"; readonly etag: Etag };

/** The answer to `writeIf`. `precondition-failed` stored nothing and left the key as it was. */
export type WriteResult = { readonly kind: "written"; readonly info: ObjectInfo } | { readonly kind: "precondition-failed" };

/** Which keys a listing returns, and how they are paged. */
export interface ListOptions {
  /** Any string, not a key: `""` lists the whole store, `"sites/"` one folder. */
  readonly prefix: string;

  /** `subtree`, the default, lists every key under the prefix. `children` stops at the next `/` and reports what lies past it as one folder. */
  readonly scope?: "subtree" | "children";

  /** The most objects and folders, counted together, in one page: 1 to `MAX_LIST_LIMIT`, which is the default. */
  readonly limit?: number;

  /** The cursor of the previous page; absent for the first. */
  readonly cursor?: ListCursor;
}

/**
 * One page of a listing, in ascending UTF-8 byte order across pages.
 *
 * A page may hold fewer entries than the limit, even none, while more remain: only `more` says whether to go on. `folders` is empty under the `subtree` scope; each ends in `/` and appears once in the whole listing.
 */
export type ListPage = { readonly objects: readonly ObjectSummary[]; readonly folders: readonly string[] } & (
  | { readonly more: false }
  | { readonly more: true; readonly cursor: ListCursor }
);

/**
 * An object store: R2 behind its binding, an S3-compatible bucket, or memory in tests.
 *
 * Every answer the product acts on is a result variant. A method rejects only when the store itself fails, or where its `@throws` says so.
 */
export interface ObjectStore {
  /** Read an object's metadata without its bytes. */
  head(key: ObjectKey): Promise<HeadResult>;

  /** Read an object, or the part of it `options.range` selects, unless `options.ifNoneMatch` names its current etag. */
  read(key: ObjectKey, options?: ReadOptions): Promise<ReadResult>;

  /**
   * Store an object, replacing whatever the key held.
   *
   * @throws {Error} a stream body ended at another length than its `size`; nothing was stored
   */
  write(key: ObjectKey, body: WriteBody, options: WriteOptions): Promise<ObjectInfo>;

  /**
   * Store an object only while `condition` holds. Of several writers holding the same condition, exactly one is answered `written`.
   *
   * @throws {Error} a stream body ended at another length than its `size`; nothing was stored
   */
  writeIf(key: ObjectKey, body: WriteBody, options: WriteOptions, condition: WriteCondition): Promise<WriteResult>;

  /** Remove an object. A key that holds none is not an error. */
  delete(key: ObjectKey): Promise<void>;

  /** Remove any number of objects. Keys that hold none are skipped, and a rejection may leave some removed. */
  deleteMany(keys: readonly ObjectKey[]): Promise<void>;

  /**
   * List one page of the keys that start with a prefix.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to `MAX_LIST_LIMIT`
   */
  list(options: ListOptions): Promise<ListPage>;
}

function isByteCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Decide whether a string is an object key. This is the one place the key rules are enforced.
 *
 * @returns the key, or the first rule it breaks
 */
export function parseObjectKey(raw: string): CheckedKey {
  if (raw.length === 0) return { ok: false, refusal: "empty" };

  if (UTF8.encode(raw).length > MAX_KEY_BYTES) return { ok: false, refusal: "too-long" };

  if (UNSTORABLE_CHARACTER.test(raw)) return { ok: false, refusal: "bad-character" };

  if (raw.normalize("NFC") !== raw) return { ok: false, refusal: "not-normalized" };

  const segments = raw.split(KEY_SEPARATOR);

  if (segments.includes("")) return { ok: false, refusal: "empty-segment" };

  if (segments.some((segment) => DOT_SEGMENTS.has(segment))) return { ok: false, refusal: "dot-segment" };

  return { ok: true, key: raw as ObjectKey };
}

/**
 * Work out which bytes of an object a range selects. Every implementation's `read` answers by this rule.
 *
 * @param size - the whole object's length in bytes
 * @returns the span, or `unsatisfiable` when the range selects no byte or holds a number that is not a whole byte count
 */
export function resolveRange(range: ByteRange, size: number): ByteSpan | "unsatisfiable" {
  if ("suffix" in range) {
    if (!isByteCount(range.suffix) || range.suffix === 0 || size === 0) return "unsatisfiable";

    const length = Math.min(range.suffix, size);

    return { offset: size - length, length };
  }

  if (!isByteCount(range.offset) || range.offset >= size) return "unsatisfiable";

  const rest = size - range.offset;
  if (range.length === undefined) return { offset: range.offset, length: rest };

  if (!isByteCount(range.length) || range.length === 0) return "unsatisfiable";

  return { offset: range.offset, length: Math.min(range.length, rest) };
}
