// The one way a record is stored: stamped with its kind's current shape, counted, checked against the schema, and written only while nobody else has written.

import type { Etag, ObjectKey, WriteCondition } from "../storage/storage";
import { checkRecord, type Draft, type RecordKind, type RecordStore, type Stamped } from "./kind";

const JSON_TYPE = "application/json";
const UTF8 = new TextEncoder();

/** What the writer last saw at the key: the record it read, or `"absent"` for a record it is creating. */
export type Held = { readonly revision: number; readonly etag: Etag } | "absent";

/**
 * The answer to `writeRecord`.
 *
 * `conflict` means the key no longer holds what the writer saw, and `invalid` that the fields are no record of the kind. Neither stored anything.
 */
export type RecordWrite<Rec> =
  | { readonly kind: "written"; readonly record: Rec; readonly etag: Etag }
  | { readonly kind: "conflict" }
  | { readonly kind: "invalid"; readonly issues: readonly string[] };

/**
 * Store a record.
 *
 * @param fields - the record without `shape` and `revision`, which are set here: the kind's shape, and one more than the revision held
 * @param held - what the writer read; the write lands only while the key still holds it
 * @returns the record as stored with its new etag, or why nothing was stored
 */
export async function writeRecord<Rec extends Stamped>(
  store: RecordStore,
  key: ObjectKey,
  kind: RecordKind<Rec>,
  fields: Draft<Rec>,
  held: Held,
): Promise<RecordWrite<Rec>> {
  const revision = held === "absent" ? 1 : held.revision + 1;
  const checked = checkRecord(kind, { ...fields, shape: kind.shape, revision });
  if (!checked.ok) return { kind: "invalid", issues: checked.issues };

  const condition: WriteCondition = held === "absent" ? { kind: "absent" } : { kind: "unchanged", etag: held.etag };
  const body = UTF8.encode(JSON.stringify(checked.record));
  const written = await store.writeIf(key, body, { contentType: JSON_TYPE }, condition);
  if (written.kind === "precondition-failed") return { kind: "conflict" };

  return { kind: "written", record: checked.record, etag: written.info.etag };
}
