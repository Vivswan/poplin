// The sweep: every record under a prefix goes through the doorway, one batch a call, so no record is left waiting for its next reader.

import type { RecordKind, RecordStore, Stamped } from "../records/kind";
import { type ReadRefusal, type RecordRead, readRecord } from "../records/read";
import type { ListCursor, ObjectKey, ObjectStore, WriteBody } from "../storage/storage";
import { REGISTRY } from "./registry";
import type { Registry } from "./upgrade";

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

/** The store operations a sweep makes. */
type SweepStore = Pick<ObjectStore, "head" | "list" | "read" | "writeIf">;

/** Which records one call visits, and whether it changes them. */
interface SweepOptions {
  /** The listing prefix that holds the kind's records and nothing else. */
  readonly prefix: string;

  /** The most records one call visits. A call makes one listing and, per record, one read and at most one write, more only while another writer keeps changing that record. */
  readonly batchSize: number;

  /** `dry-run` takes every decision `apply` takes and stores nothing: each write becomes a `head` call and an entry in `planned`. */
  readonly mode: "apply" | "dry-run";

  /** Where the previous call stopped; absent for the first. */
  readonly cursor?: ListCursor;
}

/** A write a dry run would have made. */
interface PlannedWrite {
  readonly key: ObjectKey;
  readonly body: string;
}

/** What one call of the sweep found and did. */
export interface SweepReport {
  /** How many records the call read. */
  readonly visited: number;

  /** The records brought up from an older shape, with the descriptions of the steps that ran. */
  readonly changed: readonly { readonly key: ObjectKey; readonly from: number; readonly steps: readonly string[] }[];

  /** The records the doorway refused; their bytes are as they were. */
  readonly refused: readonly { readonly key: ObjectKey; readonly refusal: ReadRefusal }[];

  /** The lowest shape still stored among the visited records once the call is done, `undefined` when none of them carries a shape. */
  readonly oldestShape: number | undefined;

  /** The writes a dry run held back, in order; empty under `apply`. */
  readonly planned: readonly PlannedWrite[];

  /** The cursor for the next call, `undefined` once the prefix is done. */
  readonly next: ListCursor | undefined;
}

async function textOf(body: WriteBody): Promise<string> {
  if ("stream" in body) return new Response(body.stream).text();

  return DECODER.decode(body);
}

function recordingStore(store: SweepStore, planned: PlannedWrite[]): RecordStore {
  return {
    read: (key, options) => store.read(key, options),

    writeIf: async (key, body, options, condition) => {
      if (condition.kind === "absent") throw new Error(`a dry run brings records up and never creates one: "${key}"`);

      // The condition is decided as the store would decide it, so a record another writer changed is read again here too.
      const head = await store.head(key);
      if (head.kind === "missing" || head.info.etag !== condition.etag) return { kind: "precondition-failed" };

      const text = await textOf(body);
      planned.push({ key, body: text });

      return { kind: "written", info: { ...head.info, size: ENCODER.encode(text).length, contentType: options.contentType, metadata: options.metadata ?? {} } };
    },
  };
}

function shapeLeft<Rec extends Stamped>(read: RecordRead<Rec>, mode: SweepOptions["mode"]): number | undefined {
  if (read.kind === "missing") return undefined;

  if (read.kind === "refused") return "stored" in read.refusal ? read.refusal.stored : undefined;

  if (read.upgrade !== undefined && mode === "dry-run") return read.upgrade.from;

  return read.record.shape;
}

/**
 * Take one batch of a kind's records through the doorway.
 *
 * @param registry - the steps of every record kind; the shipped ones unless a test brings its own
 * @returns what the batch held; call again with `next` until it is `undefined`, and take the lowest `oldestShape` of the calls
 * @throws {RangeError} `batchSize` is not a whole number from 1 to the store's listing limit
 */
export async function sweepBatch<Rec extends Stamped>(store: SweepStore, kind: RecordKind<Rec>, options: SweepOptions, registry: Registry = REGISTRY): Promise<SweepReport> {
  const planned: PlannedWrite[] = [];
  const door = options.mode === "dry-run" ? recordingStore(store, planned) : store;
  const page = await store.list({ prefix: options.prefix, limit: options.batchSize, ...(options.cursor === undefined ? {} : { cursor: options.cursor }) });
  const changed: { key: ObjectKey; from: number; steps: readonly string[] }[] = [];
  const refused: { key: ObjectKey; refusal: ReadRefusal }[] = [];
  const shapes: number[] = [];
  let visited = 0;

  for (const { key } of page.objects) {
    const read = await readRecord(door, key, kind, registry);
    if (read.kind === "missing") continue;

    visited += 1;
    const shape = shapeLeft(read, options.mode);
    if (shape !== undefined) shapes.push(shape);

    if (read.kind === "refused") refused.push({ key, refusal: read.refusal });

    if (read.kind === "found" && read.upgrade !== undefined) changed.push({ key, ...read.upgrade });
  }

  return {
    visited,
    changed,
    refused,
    oldestShape: shapes.length === 0 ? undefined : Math.min(...shapes),
    planned,
    next: page.more ? page.cursor : undefined,
  };
}
