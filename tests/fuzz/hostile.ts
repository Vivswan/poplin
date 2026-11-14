// Hostile strings for the fuzz targets: a valid shape, the same shape with a few edits, or plain noise.
//
// The confusables read as an ASCII letter, digit, or separator, and the first two (the Kelvin sign, the long s) change case into one.
// A twin is the confusable of one character: the edit that leaves a valid shape looking unchanged.

import fc from "fast-check";

const CONTROLS = ["\0", "\t", "\n", "\r", "\u001b", "\u007f", "\u0085"];
const WHITESPACE = [" ", "  ", "\u00a0", "\u2003", "\u2028", "\u3000", "\ufeff"];
const INVISIBLES = ["\u200b", "\u200d", "\u202e", "\u00ad"];
const SURROGATE_HALVES = ["\ud800", "\udbff", "\udc00", "\udfff"];
const ASCII_CONFUSABLES = ["\u212a", "\u017f", "\u0131", "\u0130", "\u0430", "\u0435", "\uff41", "\uff10", "\u2010", "\u2212", "\uff0d", "\u2024", "\uff0e", "\u2215", "\uff0f", "\uff20"];
const UNNORMALIZED = ["e\u0301", "\u212b", "\ufb01", "\u1e9b\u0323"];
const PERCENT_ENCODED = ["%00", "%0a", "%20", "%2e", "%2E%2E", "%2f", "%2e%2e%2f", "%5c", "%252e", "%c0%ae", "%", "%zz"];
const SEPARATORS = ["-", "--", "---", ".", "..", "...", "/", "//", "/./", "/../", "\\", "..\\", "_", "@", "@@", ":", ";", "?", "#", "+", "=", "~", "*", "'", '"', "<", ">"];
const FRAGMENTS = [...CONTROLS, ...WHITESPACE, ...INVISIBLES, ...SURROGATE_HALVES, ...ASCII_CONFUSABLES, ...UNNORMALIZED, ...PERCENT_ENCODED, ...SEPARATORS];
const TWINS: ReadonlyMap<string, string> = new Map([
  ["0", "\uff10"], ["k", "\u212a"], ["s", "\u017f"], ["i", "\u0131"], ["a", "\u0430"], ["e", "\u0435"],
  ["o", "\u043e"], ["c", "\u0441"], ["-", "\u2010"], [".", "\u2024"], ["/", "\u2215"], ["@", "\uff20"], ["_", "\uff3f"],
]);
const MAX_EDITS = 4;
const MAX_REPEATS = 300;
const MAX_LENGTH = 2048;

type Edit =
  | { readonly kind: "insert" | "replace"; readonly at: number; readonly fragment: string }
  | { readonly kind: "delete" | "double" | "upper" | "twin" | "truncate"; readonly at: number }
  | { readonly kind: "pad"; readonly fragment: string }
  | { readonly kind: "repeat"; readonly times: number };

function applyEdit(text: string, edit: Edit): string {
  if (edit.kind === "pad") return `${edit.fragment}${text}${edit.fragment}`;

  if (edit.kind === "repeat") return text.repeat(edit.times).slice(0, MAX_LENGTH);

  const at = edit.at < 0 ? Math.max(0, text.length + edit.at) : edit.at % (text.length + 1);
  const head = text.slice(0, at);
  const tail = text.slice(at);

  if (edit.kind === "insert") return `${head}${edit.fragment}${tail}`;

  if (edit.kind === "replace") return `${head}${edit.fragment}${tail.slice(1)}`;

  if (edit.kind === "delete") return `${head}${tail.slice(1)}`;

  if (edit.kind === "double") return `${head}${tail.slice(0, 1)}${tail}`;

  if (edit.kind === "twin") return `${head}${TWINS.get(tail.slice(0, 1)) ?? tail.slice(0, 1)}${tail.slice(1)}`;

  if (edit.kind === "upper") return `${head}${tail.slice(0, 1).toUpperCase()}${tail.slice(1)}`;

  return head;
}

function edits(): fc.Arbitrary<readonly Edit[]> {
  const at = fc.oneof(fc.integer({ min: -4, max: 3 }), fc.nat());
  const fragment = fc.oneof(fc.constantFrom(...FRAGMENTS), fc.string({ unit: "binary", minLength: 1, maxLength: 3 }));

  const edit = fc.oneof<fc.Arbitrary<Edit>[]>(
    fc.record({ kind: fc.constantFrom("insert" as const, "replace" as const), at, fragment }),
    fc.record({ kind: fc.constantFrom("delete" as const, "double" as const, "upper" as const, "twin" as const, "twin" as const, "truncate" as const), at }),
    fc.record({ kind: fc.constant("pad" as const), fragment: fc.constantFrom(...WHITESPACE, ...CONTROLS) }),
    fc.record({ kind: fc.constant("repeat" as const), times: fc.integer({ min: 2, max: MAX_REPEATS }) }),
  );

  return fc.oneof({ arbitrary: fc.array(edit, { minLength: 1, maxLength: 1 }), weight: 3 }, { arbitrary: fc.array(edit, { minLength: 2, maxLength: MAX_EDITS }), weight: 1 });
}

/**
 * Surround a valid shape with the inputs a parser must survive.
 *
 * @param valid - strings the parser under test accepts, or nearly accepts
 * @returns mostly `valid` values after one to four edits (a fragment put in, a character dropped, doubled, or raised, padding, repetition, truncation), with untouched values, mixed case, and noise beside them
 */
export function hostile(valid: fc.Arbitrary<string>): fc.Arbitrary<string> {
  const edited = fc.tuple(valid, edits()).map(([text, steps]) => steps.reduce(applyEdit, text));
  const stitched = fc.array(fc.oneof(valid, fc.constantFrom(...FRAGMENTS)), { maxLength: 8 }).map((parts) => parts.join(""));
  const noise = fc.oneof(fc.string({ unit: "binary" }), fc.string({ unit: "grapheme", size: "large" }), fc.string({ unit: "binary-ascii" }));

  return fc.oneof({ arbitrary: edited, weight: 6 }, { arbitrary: valid, weight: 2 }, { arbitrary: fc.mixedCase(valid), weight: 1 }, { arbitrary: stitched, weight: 2 }, { arbitrary: noise, weight: 1 });
}
