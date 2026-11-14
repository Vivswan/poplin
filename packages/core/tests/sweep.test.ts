import { describe, expect, test } from "bun:test";

import { type SweepReport, sweepBatch } from "../src/migrations/sweep";
import { readRecord } from "../src/records/read";
import { writeRecord } from "../src/records/write";
import { MemoryStore } from "../src/storage/memory";
import type { ListCursor, ObjectStore } from "../src/storage/storage";
import { BROKEN_TAGS, counting, NOTE, NOTE_STEPS, noteKey, putRaw, RENAME_TEXT, stored } from "./note-kind";

const PREFIX = ".notes/";
const NAMES = ["a", "b", "c", "d", "e"];
const SHAPE_OF: Readonly<Record<string, unknown>> = {
  a: { shape: 1, revision: 1, text: "a" },
  b: { shape: 3, revision: 1, title: "b", tags: [] },
  c: { shape: 2, revision: 1, title: "c" },
  d: { shape: 3, revision: 1, title: "d", tags: [] },
  e: { shape: 1, revision: 1, text: "e" },
};

async function seeded(): Promise<ObjectStore> {
  const store = new MemoryStore();

  for (const name of NAMES) await putRaw(store, noteKey(name), SHAPE_OF[name]);

  return store;
}

async function sweepAll(store: ObjectStore, mode: "apply" | "dry-run", registry = NOTE_STEPS): Promise<SweepReport[]> {
  const reports: SweepReport[] = [];
  let cursor: ListCursor | undefined;

  do {
    const report = await sweepBatch(store, NOTE, { prefix: PREFIX, batchSize: 2, mode, ...(cursor === undefined ? {} : { cursor }) }, registry);
    reports.push(report);
    cursor = report.next;
  } while (cursor !== undefined);

  return reports;
}

async function shapesStored(store: ObjectStore): Promise<unknown[]> {
  const notes = await Promise.all(NAMES.map((name) => stored(store, noteKey(name))));

  return notes.map((note) => (note?.value as { shape: number } | undefined)?.shape);
}

/** A store on which another reader brings a note up, and its owner then rewrites it, between this sweep's read of it and its write back. */
function overtaken(store: ObjectStore, name: string): ObjectStore {
  let overtook = false;

  return {
    ...counting(store).store,
    read: async (key, options) => {
      const result = await store.read(key, options);
      if (key !== noteKey(name) || overtook) return result;

      overtook = true;
      const read = await readRecord(store, key, NOTE, NOTE_STEPS);
      if (read.kind === "found") await writeRecord(store, key, NOTE, { title: "bread", tags: [] }, { revision: read.record.revision, etag: read.etag });

      return result;
    },
  };
}

describe("sweepBatch", () => {
  test("drift: a sweep that skipped or repeated a record across batches would report an install as current while old records remain", async () => {
    const inner = await seeded();
    const { store, calls } = counting(inner);

    const reports = await sweepAll(store, "apply");

    expect(reports.map((report) => [report.visited, report.changed.map((change) => [change.key, change.from]), report.oldestShape, report.planned])).toEqual([
      [2, [[noteKey("a"), 1]], 3, []],
      [2, [[noteKey("c"), 2]], 3, []],
      [1, [[noteKey("e"), 1]], 3, []],
    ]);
    expect(reports.flatMap((report) => report.changed.map((change) => change.steps))).toEqual([["rename text to title", "add an empty tag list"], ["add an empty tag list"], ["rename text to title", "add an empty tag list"]]);
    expect([await shapesStored(inner), calls]).toEqual([[3, 3, 3, 3, 3], { reads: 5, writes: 3 }]);
    expect((await sweepAll(store, "apply")).flatMap((report) => report.changed)).toEqual([]);
  });

  test("drift: a dry run that took another path than the real one would promise changes the real run does not make", async () => {
    const inner = await seeded();
    const { store, calls } = counting(inner);
    const before = await Promise.all(NAMES.map((name) => stored(inner, noteKey(name))));

    const dry = await sweepAll(store, "dry-run");

    expect(calls.writes).toBe(0);
    expect(await Promise.all(NAMES.map((name) => stored(inner, noteKey(name))))).toEqual(before);
    expect(dry.map((report) => report.oldestShape)).toEqual([1, 2, 1]);

    const applied = await sweepAll(store, "apply");
    const written = await Promise.all(["a", "c", "e"].map(async (name) => ({ key: noteKey(name), body: JSON.stringify((await stored(store, noteKey(name)))?.value) })));

    expect(dry.flatMap((report) => report.planned)).toEqual(written);
    expect(dry.map((report) => [report.visited, report.changed, report.refused])).toEqual(applied.map((report) => [report.visited, report.changed, report.refused]));
  });

  test("drift: a dry run that skipped the write's condition would plan a write the real run never makes, over a record changed in between", async () => {
    const reports = await Promise.all(["dry-run" as const, "apply" as const].map(async (mode) => sweepBatch(overtaken(await seeded(), "a"), NOTE, { prefix: PREFIX, batchSize: 1, mode }, NOTE_STEPS)));

    expect(reports.map((report) => [report.changed, report.planned, report.oldestShape])).toEqual([
      [[], [], 3],
      [[], [], 3],
    ]);
  });

  test("drift: a record still being changed by another writer is old until it is seen current; leaving it out would report the install done", async () => {
    const inner = await seeded();
    const busy: ObjectStore = { ...counting(inner).store, writeIf: async () => ({ kind: "precondition-failed" }) };

    const report = await sweepBatch(busy, NOTE, { prefix: PREFIX, batchSize: 2, mode: "apply" }, NOTE_STEPS);

    expect<unknown>([report.oldestShape, report.refused]).toEqual([1, [{ key: noteKey("a"), refusal: { reason: "contended", stored: 1 } }]]);
  });

  test("drift: a record the doorway refuses must show in the report and hold the oldest shape down, or doctor would call a stuck install current", async () => {
    const store = await seeded();
    await putRaw(store, noteKey("f"), "{");
    await putRaw(store, noteKey("g"), { shape: 1, text: "g" });

    const reports = await sweepAll(store, "apply", { note: [RENAME_TEXT, BROKEN_TAGS] });
    const failed = (name: string, shape: number): unknown => ({
      key: noteKey(name),
      refusal: { reason: "step-failed", stored: shape, from: 2, description: "add an empty tag list", message: "the tag list is unknown" },
    });

    expect<unknown>(reports.map((report) => [report.visited, report.oldestShape, report.refused])).toEqual([
      [2, 1, [failed("a", 1)]],
      [2, 2, [failed("c", 2)]],
      [2, 1, [failed("e", 1), { key: noteKey("f"), refusal: { reason: "unreadable" } }]],
      [1, 1, [{ key: noteKey("g"), refusal: { reason: "invalid", stored: 1, issues: ["revision: a stored record counts its writes from 1"] } }]],
    ]);
    expect(await shapesStored(store)).toEqual([1, 3, 2, 3, 1]);
  });
});
