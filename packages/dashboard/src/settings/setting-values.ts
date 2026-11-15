// How a setting's text is put into its control and read back, and how a value is written where it is only read. The text is the one form the server shows and takes: `9000MB`, `25%`, `on`, `never`.

import type { Row } from "@/settings/settings-queries";
import { unitWord, wordsOf } from "@/settings/settings-words";

/** How a number is written where it is only read: with separators between its thousands. */
const COUNT_FORMAT = new Intl.NumberFormat("en-US");

/** The two parts of a number's text: its count, which may be none, and the unit after it. The field lets in whole counts from 0 up alone. */
const PARTS = /^([0-9]*)(.*)$/;

/** A number's text taken apart. */
interface Parts {
  /** The count; `null` for the word of no number and for a text with no count. */
  readonly count: number | null;

  /** The unit after the digits, such as `MB`, `%`, or nothing. */
  readonly unit: string;
}

/** The word of a number control that can hold no number, such as `never`; `null` for every other row. */
function wordOf(row: Row): string | null {
  return row.control.kind === "number" ? row.control.word : null;
}

/**
 * Take a number's text apart.
 *
 * @param text - the setting's text, such as `9000MB`, `25%`, `MB`, or `never`
 * @returns the count and the unit the text itself carries; for the word of no number, no count and the unit of the row
 */
export function partsOf(row: Row, text: string): Parts {
  if (text === wordOf(row)) return { count: null, unit: row.unit };

  const [, typed = "", unit = ""] = PARTS.exec(text) ?? [];

  return { count: typed === "" ? null : Number(typed), unit };
}

/**
 * The text of a number: `partsOf` read back.
 *
 * @returns the count with its unit. No count is the word of no number where the row has one and no choice of its own for it, and otherwise the unit alone, which the server refuses
 */
export function textOf(row: Row, { count, unit }: Parts): string {
  if (count !== null) return `${count}${unit}`;

  return wordsOf(row.key).wordLabels === undefined ? (wordOf(row) ?? unit) : unit;
}

/**
 * Whether a switch is on.
 *
 * @param text - the setting's text: `on` or `off`, or for a choice of two drawn as a switch one of its options
 */
export function isOn(row: Row, text: string): boolean {
  return text === (wordsOf(row.key).on ?? "on");
}

/**
 * The text of a switch: `isOn` read back.
 *
 * @returns `on` or `off`; for a choice of two drawn as a switch, the option that is on or the other one
 */
export function switchText(row: Row, on: boolean): string {
  const onText = wordsOf(row.key).on;
  if (onText === undefined || row.control.kind !== "choice") return on ? "on" : "off";

  return on ? onText : (row.control.options.find((option) => option !== onText) ?? onText);
}

/**
 * What an option of a choice is called.
 *
 * @returns the setting's own word for it, or the option with a capital letter
 */
export function choiceLabel(row: Row, option: string): string {
  return wordsOf(row.key).choices?.[option] ?? `${option.slice(0, 1).toUpperCase()}${option.slice(1)}`;
}

/** Whether a row is drawn as a switch: an on or off, or a choice of two whose words name the one that is on. */
export function isSwitch(row: Row): boolean {
  return row.control.kind === "switch" || (row.control.kind === "choice" && wordsOf(row.key).on !== undefined);
}

/**
 * Write a value of a setting where it is only read: its default.
 *
 * @returns `On` or `Off` for a switch, the option's name for a choice, a number with separators and its unit, the name of the word of no number, any other text unchanged
 */
export function readOf(row: Row, text: string): string {
  if (isSwitch(row)) return isOn(row, text) ? "On" : "Off";

  if (row.control.kind === "choice") return choiceLabel(row, text);

  if (row.control.kind !== "number") return text;

  const words = wordsOf(row.key);
  if (text === wordOf(row)) return words.wordLabels?.word ?? words.empty ?? text;

  const parts = partsOf(row, text);
  if (parts.count === null) return text;

  const unit = unitWord(row.key, parts.unit);

  return unit === "%" ? `${COUNT_FORMAT.format(parts.count)}%` : `${COUNT_FORMAT.format(parts.count)} ${unit}`.trim();
}
