// How a setting's text is put into its control and read back: a number without its suffix, a list one entry on a line, everything else as it is typed.

import type { Row } from "@/settings/settings-queries";
import { wordsOf } from "@/settings/settings-words";

/** What a switch's two states are called. */
const SWITCH_WORDS: Readonly<Record<string, string>> = { on: "On", off: "Off" };

/** How a number is written where it is only read: with separators between its thousands. */
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

/** A whole number as text. */
const DIGITS = /^[0-9]+$/;

function withoutSuffix(row: Row, text: string): string {
  return row.suffix !== "" && text.endsWith(row.suffix) ? text.slice(0, -row.suffix.length) : text;
}

/**
 * What a control shows for a setting's text.
 *
 * @param text - the setting's value in the form it is saved in, such as `25%` or `a@example.com,b@example.com`
 * @returns the digits of a number, the entries of a list one on a line, any other text unchanged
 */
export function shownOf(row: Row, text: string = row.text): string {
  if (row.control.kind === "number") return withoutSuffix(row, text);

  return row.control.kind === "lines" ? text.split(",").join("\n") : text;
}

/**
 * What is saved for what a control holds: `shownOf` read back.
 *
 * @param shown - what the control holds, as it was typed
 * @returns the text the setting is saved as. Typed text is trimmed, a number gets its suffix back, and the lines of a list are joined, the empty ones left out
 */
export function sentOf(row: Row, shown: string): string {
  if (row.control.kind === "number") return `${shown.trim()}${row.suffix}`;

  if (row.control.kind !== "lines") return shown.trim();

  return shown
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .join(",");
}

/**
 * Write a value of a setting where it is only read: a default, or a setting changed elsewhere.
 *
 * @returns `On` or `Off` for a switch, a number with separators and its unit, any other text unchanged
 */
export function readOf(row: Row, text: string): string {
  if (row.control.kind === "switch") return SWITCH_WORDS[text] ?? text;

  if (row.control.kind !== "number") return text;

  const digits = withoutSuffix(row, text);
  const unit = row.suffix === "" ? ` ${wordsOf(row.key).unit ?? ""}` : row.suffix;

  return DIGITS.test(digits) ? `${COUNT_FORMAT.format(Number(digits))}${unit}`.trim() : text;
}
