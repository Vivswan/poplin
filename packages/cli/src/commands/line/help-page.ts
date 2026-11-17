// The one layout of every help text, by commander: a usage, what the command does, and titled parts of rows, of text, or of command lines.
//
//   a terminal      as wide as the terminal, titles bold, what is typed cyan, what is read dim
//   a pipe, a file  the same words, plain, in lines of at most 80 characters

import { styleText } from "node:util";

import { Help } from "commander";

import { foldedText, type Look } from "../../local/screen";

/** How wide the left column of a page is at least: as wide as the longest flag of a command with its value, so that a sentence of 53 characters stands whole on a line of 80. */
const TERM_WIDTH = 23;

/** The narrowest column a description is still folded into: on a terminal under 48 wide a row is left to the terminal. */
const MIN_FOLD = 20;

/** How far a line of a list stands in. */
const INDENT = "  ";

/** What a point of a list starts with, under which its later rows hang. */
const POINT = "- ";

/** What a usage starts with. */
const USAGE = "Usage:";

/** What stands before each line of a usage after the first, under its title. */
const USAGE_NEXT = " ".repeat(USAGE.length + 1);

/** Paints a text whatever the stream is: a help text is painted only for a look in colour. */
const ALWAYS = { validateStream: false } as const;

/** The paint of a help text, as commander's hooks. What is read is dim on the terminal's own colour, never the bright black a dark theme hides. */
const PAINT: Partial<Help> = {
  styleTitle: (title) => styleText("bold", title, ALWAYS),
  styleCommandText: (words) => styleText("cyan", words, ALWAYS),
  styleOptionTerm: (term) => styleText("cyan", term, ALWAYS),
  styleDescriptionText: (words) => styleText("dim", words, ALWAYS),
};

/** One part of a help text under its title: rows of a term and what it means, then a text folded to the look, then points of one fact each, then command lines as they are typed. A part with none of them is left out. */
export interface HelpPart {
  readonly title: string;
  readonly rows?: readonly (readonly [term: string, about: string])[];
  readonly text?: string;
  readonly points?: readonly string[];
  readonly commands?: readonly string[];
}

/** A help text before it is laid out: each form of the command line, what the command does, and its parts in order. */
export interface HelpPage {
  readonly usage: readonly string[];
  readonly about?: string;
  readonly parts: readonly HelpPart[];
}

/** Paint what is read line by line, so that no line is left with an open sequence; nothing for an empty text. */
function read(words: string, helper: Help): string {
  return words
    .split("\n")
    .map((line) => (line === "" ? line : helper.styleDescriptionText(line)))
    .join("\n");
}

/** The rows of a part, the left column as wide as the widest term of the page. */
function rowsOf(part: HelpPart, helper: Help, width: number): string[] {
  return (part.rows ?? []).map(([term, about]) => helper.formatItem(helper.styleOptionTerm(term), width, read(about, helper), helper));
}

/** The lines of a part under its rows, each standing in: its text folded, each point with its later rows under its words, and its command lines. */
function linesOf(part: HelpPart, helper: Help, width: number): string[] {
  const room = width - INDENT.length;
  const text = part.text === undefined ? [] : read(helper.boxWrap(part.text, room), helper).split("\n");
  const points = (part.points ?? []).flatMap((point) =>
    read(helper.boxWrap(point, room - POINT.length), helper)
      .split("\n")
      .map((row, index) => `${index === 0 ? helper.styleDescriptionText(POINT) : " ".repeat(POINT.length)}${row}`),
  );
  const commands = (part.commands ?? []).map((line) => helper.styleCommandText(line));

  return [...text, ...points, ...commands].map((line) => `${INDENT}${line}`);
}

/**
 * Lay a help text out for a stream.
 *
 * @param look - how wide the stream shows it and whether in colour
 * @returns the lines with no trailing newline, with colour sequences only for a look in colour. Only a word wider than the look, such as an address, stands on a line wider than it
 */
export function helpPage(page: HelpPage, look: Look): string {
  const helper = Object.assign(new Help(), look.colour ? PAINT : {}, { helpWidth: look.width, minWidthToWrap: MIN_FOLD });
  const usage = page.usage.map((line, index) => (index === 0 ? `${helper.styleTitle(USAGE)} ${helper.styleUsage(line)}` : `${USAGE_NEXT}${helper.styleUsage(line)}`));
  const about = page.about === undefined ? [] : [[read(helper.boxWrap(page.about, look.width), helper)]];
  const column = Math.max(TERM_WIDTH, ...page.parts.flatMap((part) => (part.rows ?? []).map(([term]) => term.length)));
  const parts = page.parts
    .map((part) => ({ title: part.title, lines: [...rowsOf(part, helper, column), ...linesOf(part, helper, look.width)] }))
    .filter((part) => part.lines.length > 0)
    .map((part) => [helper.styleTitle(part.title), ...part.lines]);

  return foldedText([usage, ...about, ...parts].map((lines) => lines.join("\n")).join("\n\n"), look.width);
}
