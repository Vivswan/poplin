// How the Activity log is written as a file: comma-separated values a spreadsheet opens, or one JSON object a line.

import { stringify } from "csv-stringify/browser/esm/sync";

/** The headings of the comma-separated file, in the order of an entry's fields. */
const HEADINGS = ["When (UTC)", "Who", "What", "Site", "Title", "Action"] as const;

/** How the comma-separated file is written: each line ends as a spreadsheet expects, and a field goes in quotes where it holds a line break or a space at an end, besides the comma and the quote that always put it there. */
const CSV = { record_delimiter: "\r\n", quoted_match: /[\r\n]|^\s|\s$/ } as const;

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

  /** The title the site has now, which the screen shows it by; empty for a site with none, a site that is gone, and an action on no site. */
  readonly title: string;

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

  /** The entries of one reading, each with the end of its line. */
  readonly lines: (entries: readonly FileEntry[]) => string;

  /** The last line of a file that holds fewer entries than the log: it says so. */
  readonly cut: (note: string) => string;
}

/** Put a field behind an apostrophe where a spreadsheet would run it as a formula. */
function asText(field: string): string {
  return STARTS_A_FORMULA.test(field) ? `'${field}` : field;
}

/** Write lines of the comma-separated file, each from its fields. */
function csvLines(lines: readonly (readonly string[])[]): string {
  return stringify(
    lines.map((fields) => fields.map(asText)),
    CSV,
  );
}

/** The formats the log is downloaded in, each by the name the address and the file's ending carry. */
export const FILE_WRITERS = {
  csv: {
    type: "text/csv; charset=utf-8",
    head: csvLines([HEADINGS]),
    lines: (entries) => csvLines(entries.map((entry) => [entry.when, entry.who, entry.what, entry.site, entry.title, entry.action])),
    cut: (note) => csvLines([[note]]),
  },
  jsonl: {
    type: "application/jsonl; charset=utf-8",
    head: "",
    lines: (entries) => entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    cut: (note) => `${JSON.stringify({ note })}\n`,
  },
} as const satisfies Readonly<Record<string, FileWriter>>;
