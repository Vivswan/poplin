// What the command modules share: the refusal of a command line, the flags as typed, and how a typed word is read.

import { posix, win32 } from "node:path";

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

/** How many single-character edits turn `typed` into `known`: an insert, a delete, a replace, or a swap of two neighbours. */
function edits(typed: string, known: string): number {
  let twoBack: number[] = [];
  let previous = Array.from({ length: known.length + 1 }, (_, column) => column);

  for (let row = 1; row <= typed.length; row += 1) {
    const current = [row];

    for (let column = 1; column <= known.length; column += 1) {
      const same = typed[row - 1] === known[column - 1];
      const swapped = row > 1 && column > 1 && typed[row - 1] === known[column - 2] && typed[row - 2] === known[column - 1];
      const replaced = (previous[column - 1] ?? 0) + (same ? 0 : 1);
      const swap = swapped ? (twoBack[column - 2] ?? 0) + 1 : Number.POSITIVE_INFINITY;

      current.push(Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, replaced, swap));
    }

    twoBack = previous;
    previous = current;
  }

  return previous[known.length] ?? 0;
}

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
  return known.find((word) => Math.abs(word.length - typed.length) <= MAX_EDITS && edits(typed, word) <= MAX_EDITS);
}
