// The control each setting is changed with on the Settings screen, read from the type of the setting's schema, so a new setting gets its control without being named here.
//
//   boolean                      switch
//   picklist                     choice of its options
//   number                       number, with the range its schema gives
//   array                        lines, one entry on each
//   string, union, an amount     text, in the form the setting is typed in

import type * as v from "valibot";

/** The kind of control each schema type gets. A type missing here has no control, and a test fails for the setting that has it. */
export const CONTROL_KINDS: Readonly<Record<string, "switch" | "choice" | "number" | "lines" | "text">> = {
  boolean: "switch",
  picklist: "choice",
  number: "number",
  array: "lines",
  string: "text",
  union: "text",
  strict_object: "text",
};

/** A setting's schema: its type, with the options of a picklist and the checks of a pipe. */
type SettingSchema = v.GenericSchema & { readonly options?: unknown; readonly pipe?: readonly { readonly type: string; readonly requirement?: unknown }[] };

/** A control and what it needs to be drawn: a choice its options, a number the least and the most it takes, `null` where the schema bounds neither. */
export type Control =
  | { readonly kind: "switch" | "lines" | "text" }
  | { readonly kind: "choice"; readonly options: readonly string[] }
  | { readonly kind: "number"; readonly least: number | null; readonly most: number | null };

function boundOf(schema: SettingSchema, check: "min_value" | "max_value"): number | null {
  const requirement = schema.pipe?.find((step) => step.type === check)?.requirement;

  return typeof requirement === "number" ? requirement : null;
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

  if (kind === "number") return { kind, least: boundOf(typed, "min_value"), most: boundOf(typed, "max_value") };

  return { kind };
}
