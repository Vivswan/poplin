// The one layout of every help text, by commander: a usage, what the command does, and titled parts of rows or of lines.
//
//   a terminal      as wide as the terminal, titles bold, the left column cyan, descriptions grey
//   a pipe, a file  the same words, plain, in lines of at most 80 characters

import { styleText } from "node:util";

import { Help } from "commander";

import { foldedText, type Look } from "../../local/screen";

/** How wide the left column of a list is at least, so that the descriptions start at column 28: wide enough for the longest flag of a command with its value. */
const TERM_WIDTH = 24;

/** The narrowest column a description is still folded into: on a terminal under 48 wide a row is left to the terminal. */
const MIN_FOLD = 20;

/** How far a line of a list stands in. */
const INDENT = "  ";

/** What a usage starts with. */
const USAGE = "Usage:";

/** What stands before each line of a usage after the first, under its title. */
const USAGE_NEXT = " ".repeat(USAGE.length + 1);

/** The room between a line of the usage and what it does. */
const USAGE_GAP = "       ";

/** Paints a text whatever the stream is: a help text is painted only for a look in colour. */
const ALWAYS = { validateStream: false } as const;

/** The paint of a help text, as commander's hooks: the colours the questions of the screen are asked in. The lines of a part keep the terminal's own colour, as what a person reads whole or copies. */
const PAINT: Partial<Help> = {
  styleTitle: (title) => styleText("bold", title, ALWAYS),
  styleCommandText: (words) => styleText("cyan", words, ALWAYS),
  styleOptionTerm: (term) => styleText("cyan", term, ALWAYS),
  styleDescriptionText: (words) => styleText("gray", words, ALWAYS),
};

/** One part of a help text under its title: rows of a term and what it means, then a text folded to the look, then whole lines as they are written. An empty line parts two paragraphs. A part with none of them is left out. */
export interface HelpPart {
  readonly title: string;
  readonly rows?: readonly (readonly [term: string, about: string])[];
  readonly text?: string;
  readonly lines?: readonly string[];
}

/** A help text before it is laid out: each form of the command line, the first with what it does where the page says so, what the command does, and its parts in order. */
export interface HelpPage {
  readonly usage: readonly (string | readonly [line: string, about: string])[];
  readonly about?: string;
  readonly parts: readonly HelpPart[];
}

function rowsOf(part: HelpPart, helper: Help): string[] {
  const rows = part.rows ?? [];
  const width = Math.max(TERM_WIDTH, ...rows.map(([term]) => term.length));

  return rows.map(([term, about]) => helper.formatItem(helper.styleOptionTerm(term), width, helper.styleOptionDescription(about), helper));
}

/**
 * Lay a help text out for a stream.
 *
 * @param look - how wide the stream shows it and whether in colour
 * @returns the lines with no trailing newline, with colour sequences only for a look in colour. Only a word wider than the look, such as an address, stands on a line wider than it
 */
export function helpPage(page: HelpPage, look: Look): string {
  const helper = Object.assign(new Help(), look.colour ? PAINT : {}, { helpWidth: look.width, minWidthToWrap: MIN_FOLD });
  const usage = page.usage.map((form, index) => {
    const [line, about] = typeof form === "string" ? [form, undefined] : form;
    const shown = about === undefined ? helper.styleUsage(line) : `${helper.styleUsage(line)}${USAGE_GAP}${helper.styleDescriptionText(about)}`;

    return index === 0 ? `${helper.styleTitle(USAGE)} ${shown}` : `${USAGE_NEXT}${shown}`;
  });
  const about = page.about === undefined ? [] : [[helper.boxWrap(helper.styleCommandDescription(page.about), look.width)]];
  const folded = (text: string | undefined): string[] => (text === undefined ? [] : helper.boxWrap(text, look.width - INDENT.length).split("\n"));
  const parts = page.parts
    .map((part) => ({ title: part.title, lines: [...rowsOf(part, helper), ...[...folded(part.text), ...(part.lines ?? [])].map((line) => (line === "" ? line : `${INDENT}${line}`))] }))
    .filter((part) => part.lines.length > 0)
    .map((part) => [helper.styleTitle(part.title), ...part.lines]);

  return foldedText([usage, ...about, ...parts].map((lines) => lines.join("\n")).join("\n\n"), look.width);
}
