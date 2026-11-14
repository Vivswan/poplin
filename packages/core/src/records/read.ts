// The doorway: the one place stored bytes become a record, and the one place a record of an older shape is brought up to date.

import * as v from "valibot";

import { REGISTRY } from "../migrations/registry";
import { type Registry, type StoredFields, type Step, type UpgradeRefusal, upgrade } from "../migrations/upgrade";
import type { Etag, ObjectKey } from "../storage/storage";
import { POSITIVE, REVISION } from "./fields";
import { checkRecord, type Draft, type RecordKind, type RecordStore, type Stamped } from "./kind";
import { writeRecord } from "./write";

/** How often a record is read again after another writer changed it between the read and the write back. */
const MAX_ATTEMPTS = 3;

/**
 * Why stored bytes were not handed out as a record. `stored` is the shape the bytes are stamped with.
 *
 * `unreadable`: not JSON, not an object, or without a whole `shape`. `code-older-than-data`: written by a newer release than this code. `invalid`: breaks the current schema, as stored or after its steps, or is older and has no `revision`.
 *
 * `no-step` and `step-failed`: the record is older and could not be brought up. `contended`: other writers kept changing it, and it was last seen at `stored`. Nothing was written in any of them.
 */
export type ReadRefusal =
  | { readonly reason: "unreadable" }
  | { readonly reason: "code-older-than-data"; readonly stored: number; readonly current: number }
  | { readonly reason: "invalid"; readonly stored: number; readonly issues: readonly string[] }
  | ({ readonly stored: number } & UpgradeRefusal)
  | { readonly reason: "contended"; readonly stored: number };

/** The answer to `readRecord`. `upgrade` is present when this read brought the record up from an older shape and wrote it back. */
export type RecordRead<Rec> =
  | { readonly kind: "found"; readonly record: Rec; readonly etag: Etag; readonly upgrade?: { readonly from: number; readonly steps: readonly string[] } }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly refusal: ReadRefusal };

/** The write back found the key changed since the read; `stored` is the shape that read saw. */
interface LostRace {
  readonly lostRace: true;
  readonly stored: number;
}

/** What one read of the key gave: the parsed JSON, `undefined` for bytes that are not JSON, and the etag of those bytes. */
interface Stored {
  readonly value: unknown;
  readonly etag: Etag;
}

function refuse(refusal: ReadRefusal): { readonly kind: "refused"; readonly refusal: ReadRefusal } {
  return { kind: "refused", refusal };
}

function asFields(value: unknown): StoredFields | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  return value as StoredFields;
}

async function readStored(store: RecordStore, key: ObjectKey): Promise<Stored | "missing"> {
  const read = await store.read(key);
  if (read.kind === "missing") return "missing";

  if (read.kind !== "found") throw new Error(`a whole read of "${key}" answered ${read.kind}`);

  const text = await new Response(read.body).text();

  try {
    return { value: JSON.parse(text), etag: read.info.etag };
  } catch {
    return { value: undefined, etag: read.info.etag };
  }
}

async function bringUp<Rec extends Stamped>(
  store: RecordStore,
  key: ObjectKey,
  kind: RecordKind<Rec>,
  steps: readonly Step[],
  old: { readonly fields: StoredFields; readonly shape: number; readonly etag: Etag },
): Promise<RecordRead<Rec> | LostRace> {
  const revision = old.fields.revision;
  if (!v.is(REVISION, revision)) return refuse({ reason: "invalid", stored: old.shape, issues: ["revision: a stored record counts its writes from 1"] });

  const upgraded = upgrade(old.fields, { from: old.shape, to: kind.shape }, steps);
  if (!upgraded.ok) return refuse({ ...upgraded.refusal, stored: old.shape });

  // Unchecked on purpose: `writeRecord` stamps the fields and checks them against the schema before it stores anything.
  const written = await writeRecord(store, key, kind, upgraded.fields as Draft<Rec>, { revision, etag: old.etag });
  if (written.kind === "conflict") return { lostRace: true, stored: old.shape };

  if (written.kind === "invalid") return refuse({ reason: "invalid", stored: old.shape, issues: written.issues });

  return { kind: "found", record: written.record, etag: written.etag, upgrade: { from: old.shape, steps: upgraded.applied } };
}

async function open<Rec extends Stamped>(store: RecordStore, key: ObjectKey, kind: RecordKind<Rec>, steps: readonly Step[], stored: Stored): Promise<RecordRead<Rec> | LostRace> {
  const fields = asFields(stored.value);
  const shape = fields?.shape;
  if (fields === undefined || !v.is(POSITIVE, shape)) return refuse({ reason: "unreadable" });

  if (shape > kind.shape) return refuse({ reason: "code-older-than-data", stored: shape, current: kind.shape });

  if (shape < kind.shape) return bringUp(store, key, kind, steps, { fields, shape, etag: stored.etag });

  const checked = checkRecord(kind, fields);
  if (!checked.ok) return refuse({ reason: "invalid", stored: shape, issues: checked.issues });

  return { kind: "found", record: checked.record, etag: stored.etag };
}

/**
 * Read a record through the doorway.
 *
 * A record of the current shape is checked and returned. An older one is run through its due steps, checked, and written back only while the key still holds the bytes that were read; a reader that loses that race reads again. A newer one is refused.
 *
 * @param registry - the steps of every record kind; the shipped ones unless a test brings its own
 * @returns the record in its current shape with the etag a later `writeRecord` needs, `missing`, or the refusal; a refused record's bytes are left as they were
 * @throws {Error} the store answered a whole read with a range or cache answer
 */
export async function readRecord<Rec extends Stamped>(store: RecordStore, key: ObjectKey, kind: RecordKind<Rec>, registry: Registry = REGISTRY): Promise<RecordRead<Rec>> {
  const steps = registry[kind.name] ?? [];

  let lastSeen = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const stored = await readStored(store, key);
    if (stored === "missing") return { kind: "missing" };

    const opened = await open(store, key, kind, steps, stored);
    if (!("lostRace" in opened)) return opened;

    lastSeen = opened.stored;
  }

  return refuse({ reason: "contended", stored: lastSeen });
}
