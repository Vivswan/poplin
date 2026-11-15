// What is kept of a failure for a bug report: its name, and its message cut and cleaned.
//
// A message can hold a value of the request that failed, so only what reads as a plain word is kept. Everything else becomes "...":
//
//   the upload "a/b.html" of ada@example.com failed at https://example.com/x?key=1 after 3 tries
//   the upload ... of ... failed at ... after 3 tries

import { MOST_MESSAGE_LENGTH, MOST_NAME_LENGTH } from "./problem";

/** What stands where something was taken out. */
const CUT = "...";

/** The most characters of a message that are read at all. */
const MOST_READ = 2000;

/** Text between double quotes or backticks, and between single quotes that open after no letter: a quoted value, never an apostrophe. */
const QUOTED = /"[^"]*"|`[^`]*`|(?<![A-Za-z])'[^']*'/g;

/** A word of letters, underscores, and apostrophes, or a short number such as a status, in brackets or before one mark of punctuation. The word itself is the one group. */
const KEPT_WORD = /^\(?([A-Za-z][A-Za-z_']{0,39}|\d{1,6})\)?[.,:;!?]?$/;

/** A run of the letters a number in hex is written with, as a word or as a part of one between underscores: a token or an id that happens to hold no digit. */
const HEX_LETTERS = /^[a-f]{8,}$/i;

/** What is kept of a failure. */
interface ProblemDetail {
  readonly name: string | null;
  readonly message: string | null;
}

/** Whether a word is too plain to be a token, an email, an address, a path, or an id with a digit. */
function isKept(word: string): boolean {
  const plain = KEPT_WORD.exec(word)?.[1];

  if (plain === undefined) return false;

  return !plain.split(/[_']/).some((part) => HEX_LETTERS.test(part));
}

/** The words of a message that are kept, each run of anything else as one cut, up to the most characters kept. */
function cleaned(message: string): string | null {
  const words = message.slice(0, MOST_READ).replace(QUOTED, ` ${CUT} `).split(/\s+/).filter((word) => word !== "");
  const kept: string[] = [];

  for (const word of words) {
    const next = isKept(word) ? word : CUT;
    if (next === CUT && kept.at(-1) === CUT) continue;

    kept.push(next);
  }

  const text = kept.join(" ");
  if (!/[A-Za-z]/.test(text)) return null;

  return text.length <= MOST_MESSAGE_LENGTH ? text : `${text.slice(0, MOST_MESSAGE_LENGTH - CUT.length)}${CUT}`;
}

/**
 * Read what is kept of a failure.
 *
 * @param failure - whatever was thrown
 * @returns the name of an `Error` where it is one plain word, and its message, or a thrown string, with every word that is no plain word cut out. `null` where there is none, or nothing of it is left
 */
export function problemDetail(failure: unknown): ProblemDetail {
  if (typeof failure === "string") return { name: null, message: cleaned(failure) };

  if (!(failure instanceof Error)) return { name: null, message: null };

  const named = isKept(failure.name) && KEPT_WORD.exec(failure.name)?.[1] === failure.name && !/^\d/.test(failure.name) && failure.name.length <= MOST_NAME_LENGTH;

  return { name: named ? failure.name : null, message: cleaned(String(failure.message)) };
}
