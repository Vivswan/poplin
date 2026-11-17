// How the commands word a count, a day, a table, and a site, so every command prints them alike.

import stringWidth from "string-width";

import type { Run } from "../../../core/src/install/installer";
import type { SiteObject } from "../../../core/src/actions/sites/site-object";
import type { Line, Screen, Tone } from "../local/screen";

/** How many characters of an ISO moment are its day. */
const DAY_LENGTH = 10;

/** What stands between two columns of a row, in every row a command lays out. */
export const GAP = "  ";

/** How wide the column of a row's object is at least, so that the rows of a run line up as they are printed one by one. */
const OBJECT_WIDTH = 20;

/** How wide the word of what was done is at least, so that the rows of most commands line up alike. */
const DONE_WIDTH = 8;

/** Who can open a site, by its access. */
const ACCESS_WORDS = { private: "login required", unlisted: "open to anyone with the URL", public: "open to everyone" } as const;

/** The last line of a dry run that asked the install what a change would come to. */
export const REHEARSED = "Dry run: the install validated the request";

/** One row of what a command did: what kind of line it is, the word of what was done, and what it was done to. */
export interface DoneRow {
  /** What kind of line the row is. */
  readonly tone: Tone;

  /** The word of what was done. */
  readonly done: string;

  /** What it was done to, in a column of its own: a row a terminal folds then goes on under `what`. */
  readonly object?: string;

  /** What the row says last: what it was done to where there is no `object`, else what is said of it. */
  readonly what: string;
}

/** The word of one state of a row in a dry run and in a run, and what kind of line it is. */
export interface StateWords {
  readonly "dry-run": string;
  readonly apply: string;
  readonly tone: Tone;
}

/**
 * Word a moment as its day in UTC, such as `2026-12-01`.
 *
 * @param moment - milliseconds since the epoch; one no calendar holds is worded as the number it is
 */
export function dayText(moment: number): string {
  const date = new Date(moment);
  if (Number.isNaN(date.getTime())) return String(moment);

  return date.toISOString().slice(0, DAY_LENGTH);
}

/**
 * Say that a dry run sent nothing.
 *
 * @param asked - whether the install was asked how it reads the site's URL, the one thing a dry run may ask
 */
export function dryRunText(asked: boolean): string {
  return asked ? "Dry run: only read-only requests were sent" : "Dry run: no request was sent";
}

/** A phrase as the start of a line: its first letter in upper case. */
export function sentenceCase(phrase: string): string {
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`;
}

/** Word a count with its noun: `1 file`, `42 files`. */
export function countText(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Lay rows out in columns, each as wide as its widest cell, measured in the cells of a terminal: a letter of Chinese takes two.
 *
 * @returns one line per row, with no trailing space
 */
export function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];

  for (const row of rows) {
    row.forEach((cell, at) => {
      widths[at] = Math.max(widths[at] ?? 0, stringWidth(cell));
    });
  }

  return rows.map((row) =>
    row
      .map((cell, at) => cell + " ".repeat((widths[at] ?? 0) - stringWidth(cell)))
      .join(GAP)
      .trimEnd(),
  );
}

/**
 * Lay one row out in columns: its state's word, as wide as the widest word of the run, then its object and its detail.
 *
 * @param states - the words of every state a row of this command can have
 * @param run - whether the row is of a dry run or of a run
 * @returns the line, whose detail stands under itself where a terminal folds it
 */
export function wordedRow<State extends string>(states: Readonly<Record<State, StateWords>>, row: { readonly state: State; readonly object: string; readonly detail: string }, run: Run): Line {
  const all: readonly StateWords[] = Object.values(states);
  const width = Math.max(...all.map((words) => words[run].length));
  const words = states[row.state];
  const cells = [words[run].padEnd(width), row.object.padEnd(OBJECT_WIDTH)];

  return { tone: words.tone, text: [...cells, row.detail].join(GAP).trimEnd(), hang: stringWidth(cells.join(GAP)) + GAP.length };
}

/** The text of a line of a result, whatever its tone. */
export function textOf(line: string | Line): string {
  return typeof line === "string" ? line : line.text;
}

/** Show one line of a result on a screen: a text as it is, and a line with its tone and its mark. */
export function showLine(screen: Pick<Screen, "line">, line: string | Line): void {
  if (typeof line === "string") screen.line("plain", line);
  else screen.line(line.tone, line.text, line.hang);
}

/**
 * Lay out what a command did as rows: the word of what was done, as wide as the widest of the rows and no narrower than the usual one, then what it was done to.
 *
 * @returns one line per row, whose last column stands under itself where a terminal folds it
 */
export function doneRows(rows: readonly DoneRow[]): Line[] {
  const width = Math.max(DONE_WIDTH, ...rows.map((row) => stringWidth(row.done)));

  return rows.map((row) => {
    const head = [`${row.done}${" ".repeat(width - stringWidth(row.done))}`, ...(row.object === undefined || row.what === "" ? [] : [row.object])];
    const last = row.what === "" ? (row.object ?? "") : row.what;

    return { tone: row.tone, text: [...head, last].join(GAP).trimEnd(), hang: stringWidth(head.join(GAP)) + GAP.length };
  });
}

/** The row that says who can open a site, with its public name where it has one. */
function accessRow(site: SiteObject): DoneRow {
  const named = site.public_name === null ? "" : `, as ${JSON.stringify(site.public_name)}`;

  return { tone: "note", done: site.access, what: `${ACCESS_WORDS[site.access]}${named}` };
}

/**
 * The lines every answer about one site ends in: what was done to which site, who can open it, and its address alone on a line.
 *
 * @param done - the word for what was done, such as `created` or `restored`
 * @param facts - what else the first row says, after the label
 * @param more - the rows between the first and the one of who can open the site
 */
export function siteLines(done: string, site: SiteObject, facts: readonly string[], more: readonly DoneRow[] = []): (string | Line)[] {
  return [...doneRows([{ tone: "done", done, object: site.label, what: facts.join(GAP) }, ...more, accessRow(site)]), "", site.url];
}

/**
 * The row for a change of access that moved a site to another address: a private site's address carries `-p-`, every other `-u-`.
 *
 * @param before - the site as the action found it, `null` for a site the action made
 * @param moved - the word of the row: what a dry run says the site would do
 * @returns one row with the old address, or none when the site kept its address
 */
export function addressChange(before: SiteObject | null, site: SiteObject, moved = "moved"): DoneRow[] {
  if (before === null || before.id !== site.id || before.addresses.site === site.addresses.site) return [];

  return [{ tone: "note", done: moved, what: `from ${before.addresses.site}` }];
}

/**
 * The note for a search-engine switch that was turned on for a site that is not public.
 *
 * @param stored - what became of the setting: a dry run says what would
 * @returns one note, or none when the switch was not turned on or the site is public
 */
export function searchNotes(changes: { readonly search_engines?: boolean | undefined }, site: SiteObject, stored = "is saved"): string[] {
  if (changes.search_engines !== true || site.access === "public") return [];

  return [`Search engines index only a public site. The setting ${stored}.`];
}
