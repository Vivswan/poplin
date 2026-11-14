// The `Range` request header, read into the one form the object store takes.

import type { ByteRange } from "@poplin/core/src/storage/storage";

/** One range of bytes: `bytes=0-99`, `bytes=100-`, or `bytes=-500`. A list of ranges does not match. */
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** The greatest last byte whose range length is still a safe integer. */
const MAX_LAST = Number.MAX_SAFE_INTEGER - 1;

/**
 * Read a `Range` header that asks for one range of bytes.
 *
 * @param header - the header's value; `null` when the request has none
 * @returns the range, its end cut to a safe integer; `undefined` for no header, another unit, several ranges, or a range that ends before it starts, each of which HTTP answers with the whole file
 */
export function parseRange(header: string | null): ByteRange | undefined {
  const [, first, last] = SINGLE_RANGE.exec(header?.trim() ?? "") ?? [];
  if (first === undefined || last === undefined) return undefined;

  if (first === "" && last === "") return undefined;

  if (first === "") return { suffix: Math.min(Number(last), Number.MAX_SAFE_INTEGER) };

  const offset = Number(first);
  if (last === "") return { offset };

  const end = Math.min(Number(last), MAX_LAST);
  if (end < offset) return undefined;

  return { offset, length: end - offset + 1 };
}
