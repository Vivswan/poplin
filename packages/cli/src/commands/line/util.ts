// What the command modules share: the refusal of a command line, the flags as typed, how a typed word is read, and how a token is kept out of what is printed.

import { posix, win32 } from "node:path";

import { stripVTControlCharacters } from "node:util";

import editDistance from "damerau-levenshtein";

import type { Screen } from "../../local/screen";

/** The most edits between a typed word and the word suggested for it. A swap of two neighbours counts as one. */
const MAX_EDITS = 1;

/** What a word starts with when it is a path that holds no separator: this folder, the one above, or the home folder. */
const PATH_STARTS = [".", "~"];

/** What parts the folders of a path, on POSIX and on Windows. */
const SEPARATORS = [posix.sep, win32.sep];

/** What stands where a token would have been printed. */
const HIDDEN = "[token]";

/** A run of control characters, the line break among them. */
const CONTROL_RUN = /\p{Cc}+/gu;

/** One control character that is no line break. */
const CONTROL_BUT_BREAK = /[^\P{Cc}\n]/gu;

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

/**
 * Take every token out of a text.
 *
 * @param tokens - the tokens this machine holds; each is replaced wherever it stands
 */
export function hide(text: string, tokens: ReadonlySet<string>): string {
  return [...tokens].reduce((safe, token) => safe.replaceAll(token, HIDDEN), text);
}

/**
 * The same screen, with every token taken out of each line, each question, and each choice before it is shown.
 *
 * A text may quote what somebody else wrote, in an account or as a site's title, so no escape sequence and no other control character of it reaches the terminal:
 * a line stays one line, and a question keeps the line breaks its list is made of.
 *
 * @param secrets - the tokens to hide, read anew for every text: one added after this call is hidden too
 */
export function guardedScreen(screen: Screen, secrets: ReadonlySet<string>): Screen {
  // A token is hidden before anything is taken out, since an escape sequence right before it ends at the token's first letter; and once more after, for a token a control character stood in.
  const shown = (text: string, controls: RegExp, as: string): string => hide(stripVTControlCharacters(hide(text, secrets)).replace(controls, as), secrets);
  const line = (text: string): string => shown(text, CONTROL_RUN, " ");
  const lines = (text: string): string => shown(text, CONTROL_BUT_BREAK, "");

  return {
    line: (tone, text, hang) => screen.line(tone, line(text), hang),
    aside: (tone, text, hang) => screen.aside(tone, line(text), hang),
    block: (title, rows) =>
      screen.block(
        line(title),
        rows.map((row) => ({ ...row, text: line(row.text) })),
      ),
    link: (text, address) => screen.link(line(text), line(address)),
    ask: (question, secret) => screen.ask(lines(question), secret),
    confirm: (question, initial) => screen.confirm(lines(question), initial),
    choose: (question, picks) =>
      screen.choose(
        lines(question),
        picks.map((pick) => ({ value: pick.value, label: line(pick.label), hint: line(pick.hint) })),
      ),
    working: (text) => screen.working(line(text)),
    rest: (left) => screen.rest(left === undefined ? undefined : line(left)),
  };
}

/**
 * Write a value as JSON with every token taken out of its texts and its keys.
 *
 * @returns one line that stays JSON however deep the value goes, and whatever a token holds
 */
export function written(value: unknown, tokens: ReadonlySet<string>): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "string") return hide(item, tokens);

    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;

    return Object.fromEntries(Object.entries(item).map(([key, held]) => [hide(key, tokens), held]));
  });
}
