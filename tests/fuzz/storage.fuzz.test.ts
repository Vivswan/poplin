// Object keys are built from uploaded file paths and byte ranges from request headers: an accepted key must stay inside its site's folder and an accepted range inside its object.

import { expect } from "bun:test";
import { posix } from "node:path";
import fc from "fast-check";

import { type ByteRange, parseObjectKey, resolveRange } from "../../packages/core/src/storage/storage";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const MAX_STORE_KEY_BYTES = 1024;
const LAST_C0_CONTROL = 0x1f;
const FIRST_C1_CONTROL = 0x7f;
const LAST_C1_CONTROL = 0x9f;
const STORE_ORIGIN = "https://bucket.example.com/";
const DOT_SEGMENT = /^(\.|%2e){1,2}$/i;

const property = fuzzTarget(import.meta.file);

const segments = fc.oneof(fc.stringMatching(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,11}$/), fc.constantFrom("index.html", "...", ".well-known", "a b", "100%", "%2e%2e%2e", "a%2e", "%2f", "%252e", "%zz", "z\u00fcrich", "~", "$1"));
const uploadPaths = fc.array(segments, { minLength: 1, maxLength: 6 }).map((path) => path.join("/"));
const dotSegments = fc.array(fc.constantFrom(".", "%2e", "%2E"), { minLength: 1, maxLength: 2 }).map((dots) => dots.join(""));

const dotPaths = fc.tuple(fc.array(segments, { maxLength: 5 }), dotSegments, fc.nat()).map(([path, dots, at]) => {
  const cut = at % (path.length + 1);

  return [...path.slice(0, cut), dots, ...path.slice(cut)].join("/");
});

const keys = hostile(fc.oneof(uploadPaths, dotPaths));
const sitePrefixes = fc.array(fc.stringMatching(/^[a-z0-9-]{1,12}$/), { minLength: 1, maxLength: 3 }).map((folders) => `${folders.join("/")}/`);
const counts = fc.oneof(fc.nat(), fc.maxSafeInteger(), fc.double(), fc.constantFrom(0, 1, -1, 0.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY));
const sizes = fc.oneof({ arbitrary: fc.oneof(fc.nat(), fc.maxSafeNat(), fc.constantFrom(0, 1)), weight: 3 }, { arbitrary: counts, weight: 1 });

const ranges: fc.Arbitrary<ByteRange> = fc.oneof(
  fc.record({ offset: counts, length: fc.option(counts, { nil: undefined }) }),
  fc.record({ suffix: counts }),
  fc.record({ offset: counts, suffix: counts }),
);

const wholeRanges: fc.Arbitrary<ByteRange> = fc.oneof(
  fc.record({ offset: fc.nat({ max: 64 }), length: fc.option(fc.integer({ min: 1, max: 64 }), { nil: undefined }) }),
  fc.record({ suffix: fc.integer({ min: 1, max: 64 }) }),
);

function isControl(character: string): boolean {
  const code = character.charCodeAt(0);

  return code <= LAST_C0_CONTROL || (code >= FIRST_C1_CONTROL && code <= LAST_C1_CONTROL);
}

property(
  "an accepted key built from an upload path stays inside its site folder, whether a path library or a store URL resolves it",
  fc.property(keys, sitePrefixes, (raw, prefix) => {
    const parsed = parseObjectKey(raw);
    if (!parsed.ok) return;

    const joined = `${prefix}${parsed.key}`;
    const storeUrl = new URL(joined.split("/").map(encodeURIComponent).join("/"), STORE_ORIGIN);
    const stored = storeUrl.pathname.slice(1).split("/").map(decodeURIComponent);

    expect(posix.normalize(joined)).toBe(joined);
    expect(stored).toEqual(joined.split("/"));
    expect(joined.split("/").filter((segment) => segment === "" || DOT_SEGMENT.test(segment))).toEqual([]);
  }),
);

property(
  "a hostile key is refused without a throw, and an accepted one has no control character, is well formed text in the NFC form R2 folds keys to, and fits the 1024 byte limit of R2 and S3",
  fc.property(keys, (raw) => {
    const parsed = parseObjectKey(raw);
    if (!parsed.ok) return;

    const facts = {
      control: Array.from(parsed.key).some(isControl),
      wellFormed: Buffer.from(parsed.key).toString() === parsed.key,
      folded: parsed.key.normalize("NFC") === parsed.key,
      fits: Buffer.byteLength(parsed.key) <= MAX_STORE_KEY_BYTES,
    };

    expect(facts).toEqual({ control: false, wellFormed: true, folded: true, fits: true });
  }),
);

property(
  "an ordinary upload path is accepted as its own key, so a tightened rule cannot drop files from a published site",
  fc.property(uploadPaths, (path) => {
    expect<unknown>(parseObjectKey(path)).toEqual({ ok: true, key: path });
  }),
);

property(
  "a path with a segment that is one or two dots, each written plain or as the escape of a dot in either case, is refused as a dot segment, so no escape a URL parser resolves away reaches the store",
  fc.property(dotPaths, (path) => {
    expect<unknown>(parseObjectKey(path)).toEqual({ ok: false, refusal: "dot-segment" });
  }),
);

property(
  "a range of an object whose size is not a whole, safe byte count is unsatisfiable, and an accepted range is asked in whole bytes, lies inside the object, holds at least one byte, and never more than the header asked for",
  fc.property(ranges, sizes, (range, size) => {
    const span = resolveRange(range, size);
    if (!(Number.isSafeInteger(size) && size >= 0)) expect(span).toBe("unsatisfiable");

    if (span === "unsatisfiable") return;

    const asked = "suffix" in range ? range.suffix : (range.length ?? size);
    const start = "suffix" in range ? size - span.length : range.offset;
    const counts = "suffix" in range ? [range.suffix] : [range.offset, range.length ?? 0];

    expect({ whole: Number.isSafeInteger(span.offset) && Number.isSafeInteger(span.length), inside: span.offset >= 0 && span.offset + span.length <= size }).toEqual({ whole: true, inside: true });
    expect(span.length).toBeWithin(1, Math.min(asked, size) + 1);
    expect(span.offset).toBe(start);
    expect(counts.filter((count) => !Number.isSafeInteger(count))).toEqual([]);
  }),
);

property(
  "a range selects exactly the bytes a slice of the object does, and is unsatisfiable only when that slice is empty",
  fc.property(fc.uint8Array({ maxLength: 48 }), wholeRanges, (object, range) => {
    // No range here has a suffix of zero: a slice from -0 is the whole object, where the header selects nothing.
    const slice = "suffix" in range ? object.subarray(-range.suffix) : object.subarray(range.offset, range.length === undefined ? undefined : range.offset + range.length);
    const span = resolveRange(range, object.length);
    const selected = span === "unsatisfiable" ? new Uint8Array() : object.subarray(span.offset, span.offset + span.length);

    expect(selected).toEqual(slice);
    expect(span === "unsatisfiable").toBe(slice.length === 0);
  }),
);
