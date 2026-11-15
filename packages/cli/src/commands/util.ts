// What the command modules share: the refusal of a command line, the flags as typed, and how a typed word is read.

import { posix, win32 } from "node:path";

import editDistance from "damerau-levenshtein";

/** The most edits between a typed word and the word suggested for it. A swap of two neighbours counts as one. */
const MAX_EDITS = 1;

/** What a word starts with when it is a path that holds no separator: this folder, the one above, or the home folder. */
const PATH_STARTS = [".", "~"];

/** What parts the folders of a path, on POSIX and on Windows. */
const SEPARATORS = [posix.sep, win32.sep];

/** A command line that was written wrong: what is wrong, and when there is one, what to type instead. */
export interface UsageError {
  readonly kind: "usage-error";
  readonly message: string;
  readonly hint?: string;
}

/** The flags a command line gave, by name with the dashes: the value of a flag that takes one, `true` for a switch. */
export type Flags = ReadonlyMap<string, string | true>;

/**
 * Refuse a command line.
 *
 * @param hint - what to type instead, when that is known
 */
export function usageError(message: string, hint?: string): UsageError {
  if (hint === undefined) return { kind: "usage-error", message };

  return { kind: "usage-error", message, hint };
}

/**
 * Tell a refusal from the value a reader returns in its place.
 */
export function isUsageError(value: unknown): value is UsageError {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "usage-error";
}

/**
 * Read the value of a flag that takes one.
 *
 * @returns the value as typed, or nothing when the flag was not given
 */
export function flagValue(flags: Flags, name: string): string | undefined {
  const value = flags.get(name);
  if (typeof value !== "string") return undefined;

  return value;
}

/**
 * Decide whether a word names a file or folder rather than a command or a site. The answer is the same on every system, and no disk is read.
 *
 * @returns true for a word that starts with `.`, `~`, or a drive such as `C:`, or holds a `/` or a `\`
 */
export function looksLikePath(word: string): boolean {
  // The Windows reading finds a drive: `C:` and `C:report` hold no separator.
  if (win32.parse(word).root !== "") return true;

  return SEPARATORS.some((separator) => word.includes(separator)) || PATH_STARTS.some((start) => word.startsWith(start));
}

/**
 * Find the known word a typed one was most likely meant to be.
 *
 * @returns the first of `known` within one edit of `typed`, or nothing when none is that close
 */
export function nearest(typed: string, known: readonly string[]): string | undefined {
  // The length check keeps a very long typed word from costing a table per known word.
  return known.find((word) => Math.abs(word.length - typed.length) <= MAX_EDITS && editDistance(typed, word).steps <= MAX_EDITS);
}
