// What makes stored bytes one kind of record: its name, its current shape number, and the schema that states that shape.

import * as v from "valibot";

import type { ObjectStore } from "../storage/storage";

/** The stamp and the counter every stored record carries, whatever its kind. */
export interface Stamped {
  readonly shape: number;
  readonly revision: number;
}

/** One kind of stored record. `schema` is the only statement of its current shape. */
export interface RecordKind<Rec extends Stamped> {
  /** The word for the kind in messages, and the name its migration steps are listed under. */
  readonly name: string;

  /** The number a record of the current shape is stamped with. */
  readonly shape: number;

  /** Accepts exactly the records of the current shape. */
  readonly schema: v.GenericSchema<unknown, Rec>;
}

/** A record's own fields, without the stamp and the counter that only a write sets. */
export type Draft<Rec> = Rec extends unknown ? Omit<Rec, "shape" | "revision"> : never;

/** The two store operations a record is read and written through. */
export type RecordStore = Pick<ObjectStore, "read" | "writeIf">;

/** A value that is a record of the kind, or what is wrong with it as `<field>: <rule>` lines. */
export type CheckedRecord<Rec> = { readonly ok: true; readonly record: Rec } | { readonly ok: false; readonly issues: readonly string[] };

/**
 * Decide whether a value is a record of a kind in its current shape.
 *
 * @returns the record as the schema types it, or every rule the value breaks
 */
export function checkRecord<Rec extends Stamped>(kind: RecordKind<Rec>, value: unknown): CheckedRecord<Rec> {
  const parsed = v.safeParse(kind.schema, value);
  if (parsed.success) return { ok: true, record: parsed.output };

  const issues = parsed.issues.map((issue) => `${v.getDotPath(issue) ?? kind.name}: ${issue.message}`);

  return { ok: false, issues };
}
