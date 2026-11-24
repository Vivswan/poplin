// How the domain stands, said two ways: the one line over the pieces, and the plain text a person copies into a chat or an issue.
//
//   the line    a mark, the count, small beside it when it was last looked at, and last the version the install runs
//   the text    poplin 0.1.2, under a domain. Checked 2026-01-01T00:00Z. 1 to repair.
//               unchanged  DNS record  every site
//               missing    DNS record  the dashboard
//
// The text leaves out who ran the check, which is a user's email, and the steps only a person can do, whose addresses name the account.

import fastStringWidth from "fast-string-width";
import type { ReactNode, Ref } from "react";

import type { Ran } from "@/domain/domain-queries";
import { type Tone, ToneMark } from "@/domain/tone-mark";

/** What a run did, said before when it was. */
export const RAN = { check: "Checked", repair: "Repaired" } as const;

/** What stands before the sentence of a problem a repair ended. */
export const REPAIRED = "Repaired:";

/** What stands before the sentence of a problem that asks for a repair, in the text. */
const TO_REPAIR = "To repair:";

/** What stands between two columns of the text. */
const GAP = "  ";

/** How many characters of an ISO moment reach its minute: `2026-01-01T00:00`. */
const MINUTE_LENGTH = 16;

/** What the line is drawn from. */
interface StatusLineProps {
  /** The count, such as `2 to repair`. */
  readonly line: string;

  /** How the count is read: nothing is left, work is left, or nothing is known. */
  readonly tone: Tone;

  /** What stands small beside the count, such as when the run was. */
  readonly beside?: ReactNode;

  /** The version the install runs, said last and faint; left out, the line names none. */
  readonly version?: string | undefined;

  /** The line itself, for a screen that moves the focus to it after a run. */
  readonly head?: Ref<HTMLDivElement>;
}

/** What the text is written from. */
export interface Status {
  /** The version the install runs; `undefined` leaves it out. */
  readonly version: string | undefined;

  /** The kind of the install, as a report says it: `under a domain`. */
  readonly kind: string;

  /** The count, or what stands in its place. */
  readonly line: string;

  /** The run on show: which run it was, when, and every piece in the order of the table. `undefined` where the screen shows none. */
  readonly ran: (Pick<Ran, "run" | "ran_at"> & { readonly rows: readonly Pick<Ran["rows"][number], "piece" | "state" | "detail">[] }) | undefined;

  /** Why the last check read nothing, in the server's sentence. */
  readonly failure: string | undefined;

  /** The sentence of each problem on the screen that asks for a repair. */
  readonly asking: readonly string[];

  /** The sentence of each problem the repair on show ended. */
  readonly mended: readonly string[];
}

/**
 * Read the version the page was handed.
 *
 * @returns the version, or `undefined` for anything that is no text or an empty one
 */
export function versionOf(handed: unknown): string | undefined {
  return typeof handed === "string" && handed !== "" ? handed : undefined;
}

/** A line as a sentence: it ends in a full stop, which a line that is a sentence already has. */
export function sentenceOf(line: string): string {
  return line.endsWith(".") ? line : `${line}.`;
}

/** A moment in UTC down to its minute, as ISO 8601 writes it: `2026-01-01T00:00Z`. */
function minuteOf(moment: number): string {
  return `${new Date(moment).toISOString().slice(0, MINUTE_LENGTH)}Z`;
}

/** Lay rows out in columns, each as wide as its widest cell in letters of one width, as a chat or an issue shows a pasted block: a letter of Chinese takes two. No line ends in a space. */
function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];

  for (const row of rows) {
    row.forEach((cell, at) => {
      widths[at] = Math.max(widths[at] ?? 0, fastStringWidth(cell));
    });
  }

  return rows.map((row) =>
    row
      .map((cell, at) => cell + " ".repeat((widths[at] ?? 0) - fastStringWidth(cell)))
      .join(GAP)
      .trimEnd(),
  );
}

/** The first line of the text: the install, when the run on show was, the count, and why a check read nothing. */
function headOf({ version, kind, line, ran, failure }: Status): string {
  const name = version === undefined ? "poplin" : `poplin ${version}`;
  const said = [`${name}, ${kind}.`];
  if (ran !== undefined) said.push(`${RAN[ran.run]} ${minuteOf(ran.ran_at)}.`);

  said.push(sentenceOf(line));
  if (failure !== undefined) said.push(sentenceOf(failure));

  return said.join(" ");
}

/**
 * Write the whole status as plain text, for a paste into a chat or an issue.
 *
 * @returns the first line, then one line per problem that asks for a repair or that a repair ended, then one line per piece in the columns state, piece, and detail
 */
export function statusText(status: Status): string {
  const toRepair = status.asking.map((sentence) => `${TO_REPAIR} ${sentence}`);
  const repaired = status.mended.map((sentence) => `${REPAIRED} ${sentence}`);
  const pieces = columns((status.ran?.rows ?? []).map((row) => [row.state, row.piece, row.detail]));

  return [headOf(status), ...toRepair, ...repaired, ...pieces].join("\n");
}

/** Draw the line. */
export function StatusLine({ line, tone, beside, version, head }: StatusLineProps): ReactNode {
  return (
    <div ref={head} tabIndex={-1} role="status" data-tone={tone} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 outline-none">
      <span className="flex items-center gap-2 font-medium">
        <ToneMark tone={tone} />
        {line}
      </span>
      {beside === undefined ? null : <span className="text-xs text-muted-foreground">{beside}</span>}
      {version === undefined ? null : <span className="text-xs text-faint">poplin {version}</span>}
    </div>
  );
}
