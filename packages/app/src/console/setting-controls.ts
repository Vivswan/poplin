// The control each setting is changed with on the Settings screen, read from the type of the setting's schema, so a new setting gets its control without being named here.
//
//   boolean                        switch
//   picklist                       choice of its options
//   number                         number, with the range its schema gives
//   a count with a unit            number, typed in the one unit the screen has for its kind
//   one word, or one of the above  that control, with the word that stands for no number
//   array                          lines, one entry on each
//   string, anything else          text, in the form the setting is typed in

import { type SettingValues, sizeBytes, spanSeconds } from "@poplin/core/src/records/settings";
import type * as v from "valibot";

/** The kind of control each schema type gets. A type missing here has no control, and a test fails for the setting that has it. */
export const CONTROL_KINDS: Readonly<Record<string, Control["kind"]>> = {
  boolean: "switch",
  picklist: "choice",
  number: "number",
  array: "lines",
  string: "text",
  union: "number",
  strict_object: "number",
};

/** The one unit each kind of amount is typed in on the screen, and how many of its smallest unit core counts an amount of that kind as. */
const SCREEN_AMOUNTS: readonly ScreenAmount[] = [
  { unit: "MB", count: (amount) => sizeBytes(amount as SettingValues["max_total_size"]) },
  { unit: "d", count: (amount) => spanSeconds(amount as Exclude<SettingValues["default_expires"], "never">) },
];

/** The digits a number's text starts with. */
const DIGITS = /^\d+/;

/** A count of one unit, as a setting holds an amount. */
interface Amount {
  readonly count: number;
  readonly unit: string;
}

/** One kind of amount on the screen. */
interface ScreenAmount {
  readonly unit: string;
  readonly count: (amount: Amount) => number;
}

/** A setting's schema: its type, with the options of a picklist or a union, the word of a literal, the fields of an amount, and the checks of a pipe. */
type SettingSchema = v.GenericSchema & {
  readonly options?: unknown;
  readonly literal?: unknown;
  readonly entries?: Readonly<Record<string, v.GenericSchema>>;
  readonly pipe?: readonly { readonly type: string; readonly requirement?: unknown }[];
};

/** A control and what it needs to be drawn: a choice its options; a number the least and the most it takes, `null` where the schema bounds neither, and the word its text is when it holds no number, `null` where it always holds one. */
export type Control =
  | { readonly kind: "switch" | "lines" | "text" }
  | { readonly kind: "choice"; readonly options: readonly string[] }
  | { readonly kind: "number"; readonly least: number | null; readonly most: number | null; readonly word: string | null };

function boundOf(schema: SettingSchema, check: "min_value" | "max_value"): number | null {
  const requirement = schema.pipe?.find((step) => step.type === check)?.requirement;

  return typeof requirement === "number" ? requirement : null;
}

/** The kind of amount a schema holds: the one whose screen unit is among the units the schema takes. None for a schema that is no amount, or an amount of a kind the screen has no unit for. */
function screenAmountOf(schema: SettingSchema): ScreenAmount | undefined {
  const { unit: units }: { readonly unit?: SettingSchema } = schema.entries ?? {};
  const taken = Array.isArray(units?.options) ? units.options : [];

  return SCREEN_AMOUNTS.find((amount) => taken.includes(amount.unit));
}

/** The two halves of a setting that is one word or something else: the word, and the schema of the rest. None for any other union. */
function wordOr(schema: SettingSchema): { readonly word: string; readonly rest: SettingSchema } | undefined {
  const options: readonly SettingSchema[] = Array.isArray(schema.options) ? schema.options : [];
  const [word, rest, ...more] = options;
  if (word?.type !== "literal" || typeof word.literal !== "string" || rest === undefined || more.length > 0) return undefined;

  return { word: word.literal, rest };
}

/** The number control of a schema that holds a plain number or an amount; none for any other. */
function numberOf(schema: SettingSchema): Extract<Control, { kind: "number" }> | undefined {
  if (schema.type === "number") return { kind: "number", least: boundOf(schema, "min_value"), most: boundOf(schema, "max_value"), word: null };

  const { count }: { readonly count?: SettingSchema } = schema.entries ?? {};
  if (count === undefined || screenAmountOf(schema) === undefined) return undefined;

  return { kind: "number", least: boundOf(count, "min_value"), most: boundOf(count, "max_value"), word: null };
}

/**
 * Read the control of a setting from its schema.
 *
 * @returns the control; a schema of a type that has none is given the text control, which every setting can be typed in
 */
export function controlOf(schema: v.GenericSchema): Control {
  const typed: SettingSchema = schema;
  const kind = CONTROL_KINDS[typed.type] ?? "text";

  if (kind === "choice") return { kind, options: Array.isArray(typed.options) ? typed.options.map(String) : [] };

  if (kind !== "number") return { kind };

  const either = wordOr(typed);
  const number = numberOf(either?.rest ?? typed);
  if (number === undefined) return { kind: "text" };

  return { ...number, word: either?.word ?? null };
}

/**
 * Write a setting's value as the screen types it: an amount in the screen's one unit for its kind, so `9GB` is `9000MB` and `48h` is `2d`.
 *
 * @param value - the setting's typed value
 * @param text - the same value in the form it is stored and printed in
 * @returns the amount in the screen's unit where it is a whole number of them; `text` unchanged for an amount that is not, such as `500KB`, and for everything that is no amount
 */
export function screenText(schema: v.GenericSchema, value: unknown, text: string): string {
  const typed: SettingSchema = schema;
  const kind = screenAmountOf(wordOr(typed)?.rest ?? typed);
  if (kind === undefined || typeof value !== "object" || value === null || !("count" in value) || !("unit" in value)) return text;

  const one = kind.count({ count: 1, unit: kind.unit });
  const all = kind.count(value as Amount);

  return all % one === 0 ? `${all / one}${kind.unit}` : text;
}

/**
 * The unit of a number's text: what follows its digits, such as `MB`, `%`, or nothing.
 *
 * @param text - the setting's text as `screenText` writes it
 * @returns the unit the text ends with; for a text that is the word of no number, the screen's unit for the amount the schema holds, or nothing
 */
export function unitOf(schema: v.GenericSchema, text: string): string {
  const typed: SettingSchema = schema;
  if (DIGITS.test(text)) return text.replace(DIGITS, "");

  return screenAmountOf(wordOr(typed)?.rest ?? typed)?.unit ?? "";
}
