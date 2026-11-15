// How the Activity log is written as a file: comma-separated values a spreadsheet opens, or one JSON object a line.

/** The most entries one file of the log holds: a whole number of the 1,000 entries one reading of the log answers. A longer log is saved as one file after another, so no request works longer than the time one is given. */
export const MOST_IN_FILE = 2000;

/** The headings of the comma-separated file, in the order of an entry's fields. */
const HEADINGS = ["When (UTC)", "Who", "What", "Site", "Action"] as const;

/** What ends a line of the comma-separated file. */
const LINE_END = "\r\n";

/** A field that holds one of these is written inside quotes. */
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** A field that starts with one of these is run as a formula by a spreadsheet. */
const STARTS_A_FORMULA = /^[=+\-@\t\r]/;

/** One entry of the log as a file holds it. */
export interface FileEntry {
  /** When it was written, as an ISO 8601 moment in UTC. */
  readonly when: string;

  /** Who did it: a login's name where it has one. */
  readonly who: string;

  /** What was done, in the sentence the screen shows. */
  readonly what: string;

  /** The name the site had then; empty for an action on no site. */
  readonly site: string;

  /** The action's own name in the log. */
  readonly action: string;

  /** What the action set. Only the JSON file holds it. */
  readonly detail: Readonly<Record<string, unknown>>;
}

/** How one format of the file is written. */
interface FileWriter {
  /** The media type the file is answered with. */
  readonly type: string;

  /** What the file starts with. */
  readonly head: string;

  /** One entry, with the end of its line. */
  readonly line: (entry: FileEntry) => string;

  /** The last line of a file that holds fewer entries than the log: it says so. */
  readonly cut: (note: string) => string;
}

/** Write one field of a comma-separated line: in quotes where it holds a comma, a quote, a line break, or a space at an end, and behind an apostrophe where a spreadsheet would run it as a formula. */
function csvField(text: string): string {
  const plain = STARTS_A_FORMULA.test(text) ? `'${text}` : text;

  return NEEDS_QUOTES.test(plain) ? `"${plain.replaceAll('"', '""')}"` : plain;
}

function csvLine(fields: readonly string[]): string {
  return `${fields.map(csvField).join(",")}${LINE_END}`;
}

/** The formats the log is downloaded in, each by the name the address and the file's ending carry. */
export const FILE_WRITERS = {
  csv: {
    type: "text/csv; charset=utf-8",
    head: csvLine(HEADINGS),
    line: (entry) => csvLine([entry.when, entry.who, entry.what, entry.site, entry.action]),
    cut: (note) => csvLine([note]),
  },
  jsonl: {
    type: "application/jsonl; charset=utf-8",
    head: "",
    line: (entry) => `${JSON.stringify(entry)}\n`,
    cut: (note) => `${JSON.stringify({ note })}\n`,
  },
} as const satisfies Readonly<Record<string, FileWriter>>;
