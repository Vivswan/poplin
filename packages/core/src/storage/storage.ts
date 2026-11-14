// The object store every product rule reads and writes through, with the key and byte-range rules its implementations share.

// `String.prototype.isWellFormed` is newer than the compile target, so this file names the library that types it.
/// <reference lib="es2024.string" />

/** The most entries one `list` call may ask for; R2 and S3 both stop a page there. */
export const MAX_LIST_LIMIT = 1000;

/** The longest key R2 and S3 both accept, in UTF-8 bytes. */
const MAX_KEY_BYTES = 1024;

/** The list pages one `deletePrefix` call walks by default: 30 store calls. A host that bounds the store calls of one request must allow that many. */
const DEFAULT_DELETE_PAGES = 15;

/** What joins a key's segments, and what ends a folder's prefix. */
const KEY_SEPARATOR = "/";

/** The most UTF-8 bytes one UTF-16 unit of a string becomes. */
const MAX_BYTES_PER_UNIT = 3;

/** Segments an S3 client or a URL parser would resolve away, as they read once percent-decoded. */
const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

/** What starts a percent escape; a segment without one decodes to itself. */
const ESCAPE = "%";

/** Where a key has an empty segment: before a separator that starts it, between two in a row, or after one that ends it. */
const EMPTY_SEGMENT = /^\/|\/\/|\/$/;

/** How a segment that decodes to `.` or `..` starts: with a dot or with an escape. A key without such a start is not split to be searched. */
const DOT_SEGMENT_START = /(?:^|\/)[.%]/;

/** A character outside ASCII. Text without one is in NFC as it stands, so it is not normalised to be compared. */
const BEYOND_ASCII = /\P{ASCII}/u;

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
 *
 * `%` is an ordinary character, kept as written. The one escape refused is a segment that percent-decodes to `.` or `..` (`%2e`, `.%2E`): a URL parser resolves it away.
 * Whatever puts a key in a URL percent-encodes each segment, so no other escape can change the path.
 */
export type ObjectKey = string & { readonly [objectKeyBrand]: true };

/**
 * A store's name for the bytes of one object, unquoted. Only a store makes one.
 *
 * It changes whenever a write changes the bytes. A write of the same bytes may keep it: R2 and S3 hash the content.
 */
export type Etag = string & { readonly [etagBrand]: true };

/** Where a listing stopped. It continues only a `list` call with the same prefix, on the store that made it. */
export type ListCursor = string & { readonly [listCursorBrand]: true };

/** Why a string is not an object key. `bad-character` is a control character or a lone surrogate. */
type KeyRefusal = "empty" | "too-long" | "bad-character" | "not-normalized" | "empty-segment" | "dot-segment";

/** A parsed key, or the first rule the string breaks. */
export type CheckedKey = { readonly ok: true; readonly key: ObjectKey } | { readonly ok: false; readonly refusal: KeyRefusal };

/** What a listing tells about an object: enough to count its bytes and to delete it. */
export interface ObjectSummary {
  /** The whole key, never the part after a listing prefix. */
  readonly key: ObjectKey;

  /** The whole object's length in bytes, also on a ranged read. */
  readonly size: number;

  /** What a visitor sends back as `ifNoneMatch` to ask whether the bytes have changed. */
  readonly etag: Etag;
}

/** Everything a store keeps about an object besides its bytes. */
export interface ObjectInfo extends ObjectSummary {
  /** The media type given at the write, served back as the `Content-Type` header. */
  readonly contentType: string;
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

/** What is stored beside the bytes. `isContentType` says which content type a store keeps; it is kept as written, without trimming, case folding, or normalising. */
export interface WriteOptions {
  readonly contentType: string;
}

/** Which keys a listing returns, and how they are paged. */
export interface ListOptions {
  /** Any well-formed string in NFC, not a key: `""` lists the whole store, `"blog/"` one folder. */
  readonly prefix: string;

  /** The most objects in one page: 1 to `MAX_LIST_LIMIT`, which is the default. */
  readonly limit?: number;

  /** The cursor of the previous page; absent for the first. */
  readonly cursor?: ListCursor;
}

/**
 * One page of a listing.
 *
 * Order: `objects` ascend by the UTF-8 bytes of their keys, which is code point order, within a page and from one page to the next.
 *
 * A page may hold fewer objects than the limit, even none, while more remain: only `more` says whether to go on.
 *
 * A listing is not a snapshot. An object that no write touches during the listing appears exactly once.
 */
export type ListPage = { readonly objects: readonly ObjectSummary[] } & (
  | { readonly more: false }
  | { readonly more: true; readonly cursor: ListCursor }
);

/**
 * An object store: R2 behind its binding, an S3-compatible bucket, or memory in tests.
 *
 * Every answer the product acts on is a result variant. A method rejects only when the store itself fails, or where its `@throws` says so.
 */
export interface ObjectStore {
  /** Read what the store keeps about an object, without its bytes. */
  head(key: ObjectKey): Promise<HeadResult>;

  /** Read an object, or the part of it `options.range` selects, unless `options.ifNoneMatch` names its current etag. */
  read(key: ObjectKey, options?: ReadOptions): Promise<ReadResult>;

  /**
   * Store an object, replacing whatever the key held.
   *
   * @throws {Error} a stream body ended at another length than its `size`; nothing was stored
   * @throws {TypeError} `checkWriteOptions` refused the options: the content type is empty, or holds a control character or a lone surrogate; nothing was stored
   */
  write(key: ObjectKey, body: WriteBody, options: WriteOptions): Promise<ObjectInfo>;

  /** Remove an object. A key that holds none is not an error. */
  delete(key: ObjectKey): Promise<void>;

  /** Remove any number of objects. Keys that hold none are skipped, and a rejection may leave some removed. */
  deleteMany(keys: readonly ObjectKey[]): Promise<void>;

  /**
   * List one page of the keys that start with a prefix.
   *
   * @throws {RangeError} `limit` is not a whole number from 1 to `MAX_LIST_LIMIT`
   * @throws {TypeError} `prefix` holds a lone surrogate or is not in NFC
   */
  list(options: ListOptions): Promise<ListPage>;
}

function isByteCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isDotSegment(segment: string): boolean {
  if (!segment.includes(ESCAPE)) return DOT_SEGMENTS.has(segment);

  try {
    return DOT_SEGMENTS.has(decodeURIComponent(segment));
  } catch {
    // A malformed escape decodes to nothing, so a URL parser leaves the segment as it is.
    return false;
  }
}

function requireWellFormed(text: string, what: string): void {
  if (!text.isWellFormed()) throw new TypeError(`${what} holds a lone surrogate, which no store can keep: ${JSON.stringify(text)}`);
}

/**
 * Decide whether a string is an object key. This is the one place the key rules are enforced.
 *
 * @returns the key, or the first rule it breaks
 */
export function parseObjectKey(raw: string): CheckedKey {
  if (raw.length === 0) return { ok: false, refusal: "empty" };

  // A key this short fits however its characters encode, so only a longer one is encoded to be measured.
  if (raw.length * MAX_BYTES_PER_UNIT > MAX_KEY_BYTES && UTF8.encode(raw).length > MAX_KEY_BYTES) return { ok: false, refusal: "too-long" };

  if (UNSTORABLE_CHARACTER.test(raw)) return { ok: false, refusal: "bad-character" };

  if (BEYOND_ASCII.test(raw) && raw.normalize("NFC") !== raw) return { ok: false, refusal: "not-normalized" };

  if (EMPTY_SEGMENT.test(raw)) return { ok: false, refusal: "empty-segment" };

  if (DOT_SEGMENT_START.test(raw) && raw.split(KEY_SEPARATOR).some(isDotSegment)) return { ok: false, refusal: "dot-segment" };

  return { ok: true, key: raw as ObjectKey };
}

/**
 * Work out which bytes of an object a range selects. Every implementation's `read` answers by this rule.
 *
 * @param size - the whole object's length in bytes
 * @returns the span, or `unsatisfiable` when the range selects no byte, or when the range or `size` holds a number that is not a whole, safe byte count
 */
export function resolveRange(range: ByteRange, size: number): ByteSpan | "unsatisfiable" {
  if (!isByteCount(size)) return "unsatisfiable";

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

/**
 * Decide whether text is a content type a file may be stored and served with. This is the one place that rule is written.
 *
 * @returns `false` for the empty string, for a control character, a line break included, which no header value carries, and for a lone surrogate, which R2 stores as U+FFFD
 */
export function isContentType(text: string): boolean {
  return text.length > 0 && !UNSTORABLE_CHARACTER.test(text);
}

/**
 * Refuse what a store could not keep as written beside the bytes. Every implementation's `write` calls it first, and nowhere else decides this.
 *
 * @returns a copy of the options to store from, so a change the caller makes while the write is under way stores nothing unchecked
 * @throws {TypeError} `isContentType` refuses the content type
 */
export function checkWriteOptions(options: WriteOptions): WriteOptions {
  const checked = { contentType: options.contentType };
  requireWellFormed(checked.contentType, "the content type");

  if (!isContentType(checked.contentType)) throw new TypeError(`the content type is empty or holds a control character, which no header carries: ${JSON.stringify(checked.contentType)}`);

  return checked;
}

/**
 * Refuse a listing no store answers as asked. Every implementation's `list` calls it first, and nowhere else decides this.
 *
 * @returns the page limit, `MAX_LIST_LIMIT` when the options name none
 * @throws {TypeError} `prefix` holds a lone surrogate, which R2 reads as U+FFFD, or is not in NFC, the form every key has
 * @throws {RangeError} `limit` is not a whole number from 1 to `MAX_LIST_LIMIT`
 */
export function checkListOptions(options: ListOptions): number {
  requireWellFormed(options.prefix, "the list prefix");

  if (options.prefix.normalize("NFC") !== options.prefix) throw new TypeError(`the list prefix is not in NFC, so no key starts with it: ${JSON.stringify(options.prefix)}`);

  const limit = options.limit ?? MAX_LIST_LIMIT;
  const valid = Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIST_LIMIT;

  if (!valid) throw new RangeError(`a list limit is a whole number from 1 to ${MAX_LIST_LIMIT}, not ${limit}`);

  return limit;
}

/**
 * Remove the objects under a folder, a page at a time, for at most `maxPages` pages. A page costs two store calls: one `list` and one `deleteMany`.
 *
 * @param prefix - the folder, ending in `/`, so that `blog/` never reaches into `blog2/`
 * @param maxPages - the most pages to walk, a whole number from 1; the default keeps one call to 30 store calls
 * @returns how many objects the pages held, and whether the page limit stopped the walk with objects left; a caller calls again, in a later request, while `more` is true
 * @throws {TypeError} `prefix` does not end in `/`, or `list` refuses it
 * @throws {RangeError} `maxPages` is not a whole number from 1
 */
export async function deletePrefix(store: ObjectStore, prefix: string, maxPages: number = DEFAULT_DELETE_PAGES): Promise<{ readonly removed: number; readonly more: boolean }> {
  if (!prefix.endsWith(KEY_SEPARATOR)) throw new TypeError(`a folder prefix ends in ${KEY_SEPARATOR}, so it cannot match a longer folder name: ${JSON.stringify(prefix)}`);

  if (!(Number.isInteger(maxPages) && maxPages >= 1)) throw new RangeError(`a page limit is a whole number from 1, not ${maxPages}`);

  let removed = 0;
  let page = await store.list({ prefix });

  for (let walked = 1; ; walked += 1) {
    await store.deleteMany(page.objects.map((object) => object.key));
    removed += page.objects.length;

    if (!page.more) return { removed, more: false };

    if (walked === maxPages) return { removed, more: true };

    page = await store.list({ prefix, cursor: page.cursor });
  }
}
