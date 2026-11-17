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

/** What the install does at an address a change took a site from, as a run says it and as a dry run does: it sends on to the new one, serves the site as before, or answers 404. */
export const OLD_ADDRESS = {
  redirects: { apply: "redirects", "dry-run": "would redirect" },
  serves: { apply: "still serves", "dry-run": "would still serve" },
  revoked: { apply: "revoked", "dry-run": "would revoke" },
} as const satisfies Readonly<Record<string, Readonly<Record<Run, string>>>>;

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
 * The rows for the addresses a change took a site from, each by what the install answers there afterwards.
 *
 * @param before - the site as the action found it, `null` for a site the action made
 * @returns no row for a site that kept its addresses, or that got a new id: the action that gives one says so itself
 */
export function oldAddressRows(before: SiteObject | null, site: SiteObject, run: Run = "apply"): DoneRow[] {
  if (before === null || before.id !== site.id) return [];

  const old = before.addresses;
  const rows: DoneRow[] = [];
  // Only the id finds a site, so an address with an older name is answered as the one with the new name is: served, or sent on to the other form when the site went to or from private.
  if ((before.access === "private") !== (site.access === "private")) rows.push({ tone: "note", done: OLD_ADDRESS.redirects[run], what: `from ${old.site}` });
  else if (old.site !== site.addresses.site) rows.push({ tone: "note", done: OLD_ADDRESS.serves[run], what: old.site });

  if (old.public !== null && old.public !== site.addresses.public) rows.push({ tone: "warning", done: OLD_ADDRESS.revoked[run], what: old.public });

  return rows;
}

/**
 * The note for a search-engine switch that was turned on for a site that is not public.
 *
 * @param stored - what became of the setting: a dry run says what would
 * @returns one note, or none when the switch was not turned on or the site is public
 */
export function searchNotes(changes: { readonly search_engines?: boolean | undefined }, site: SiteObject, stored = "is saved"): string[] {
  if (changes.search_engines !== true || site.access === "public") return [];

  return [`The setting ${stored}, but search engines index only a public site`];
}
