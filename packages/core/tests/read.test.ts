import { describe, expect, test } from "bun:test";

import { readRecord } from "../src/records/read";
import { MemoryStore } from "../src/storage/memory";
import type { ObjectStore } from "../src/storage/storage";
import { BROKEN_TAGS, counting, NOTE, NOTE_STEPS, noteKey, putRaw, RENAME_TEXT, stored } from "./note-kind";

const KEY = noteKey("list");
const CURRENT = { shape: 3, revision: 5, title: "milk", tags: ["shop"] };
const UNREADABLE = { kind: "refused", refusal: { reason: "unreadable" } };

/** A store that holds every conditional write back until two reads have been answered, so two readers both see the old bytes. */
function racing(store: ObjectStore): ObjectStore {
  let reads = 0;
  let release: () => void = () => {};
  const bothRead = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    ...store,
    read: async (key, options) => {
      const result = await store.read(key, options);
      reads += 1;
      if (reads === 2) release();

      return result;
    },
    writeIf: async (key, body, options, condition) => {
      await bothRead;

      return store.writeIf(key, body, options, condition);
    },
  };
}

describe("readRecord", () => {
  // Drift: the doorway is the only reader of stored bytes; a row that slipped would hand out a record no schema states, or rewrite one it should have left.
  test.each([
    ["not JSON", "{", UNREADABLE],
    ["a list", [1], UNREADABLE],
    ["null", null, UNREADABLE],
    ["no shape", { revision: 1, title: "milk", tags: [] }, UNREADABLE],
    ["a shape that is text", { shape: "3", revision: 1, title: "milk", tags: [] }, UNREADABLE],
    ["shape zero", { shape: 0, revision: 1, text: "milk" }, UNREADABLE],
    ["a fractional shape", { shape: 1.5, revision: 1, text: "milk" }, UNREADABLE],
    ["an older shape with no revision", { shape: 1, text: "milk" }, { kind: "refused", refusal: { reason: "invalid", stored: 1, issues: ["revision: a stored record counts its writes from 1"] } }],
    ["a newer shape", { shape: 4, revision: 1, title: "milk", tags: [], color: "red" }, { kind: "refused", refusal: { reason: "code-older-than-data", stored: 4, current: 3 } }],
    [
      "the current shape with a field missing",
      { shape: 3, revision: 1, title: "milk" },
      { kind: "refused", refusal: { reason: "invalid", stored: 3, issues: ['tags: Invalid key: Expected "tags" but received undefined'] } },
    ],
    [
      "the current shape with a field too many",
      { ...CURRENT, color: "red" },
      { kind: "refused", refusal: { reason: "invalid", stored: 3, issues: ['color: Invalid key: Expected never but received "color"'] } },
    ],
    [
      "an older shape whose steps end in an invalid record",
      { shape: 2, revision: 1, title: 7 },
      { kind: "refused", refusal: { reason: "invalid", stored: 2, issues: ["title: Invalid type: Expected string but received 7"] } },
    ],
  ])("refuses %s and leaves the bytes alone", async (_, value, outcome) => {
    const { store, calls } = counting(new MemoryStore());
    const etag = await putRaw(store, KEY, value);

    expect<unknown>(await readRecord(store, KEY, NOTE, NOTE_STEPS)).toEqual(outcome);
    const head = await store.head(KEY);

    expect([calls.writes, head.kind === "found" && head.info.etag]).toEqual([0, etag]);
  });

  test("drift: a missing key is an answer of its own, never a refusal, since a new site has no record yet", async () => {
    expect<unknown>(await readRecord(new MemoryStore(), KEY, NOTE, NOTE_STEPS)).toEqual({ kind: "missing" });
  });

  test("drift: a record of the current shape is handed out as stored, with the etag a later write needs, and is not rewritten", async () => {
    const { store, calls } = counting(new MemoryStore());
    const etag = await putRaw(store, KEY, CURRENT);

    expect<unknown>(await readRecord(store, KEY, NOTE, NOTE_STEPS)).toEqual({ kind: "found", record: CURRENT, etag });
    expect(calls).toEqual({ reads: 1, writes: 0 });
  });

});

describe("readRecord on a record of an older shape", () => {
  test("drift: an older record is brought up and written back once; if the write back were skipped every later read would run the steps again", async () => {
    const inner = new MemoryStore();
    const { store, calls } = counting(inner);
    await putRaw(inner, KEY, { shape: 1, revision: 5, text: "milk" });
    const upgraded = { shape: 3, revision: 6, title: "milk", tags: [] };

    const first = await readRecord(store, KEY, NOTE, NOTE_STEPS);
    const after = await stored(inner, KEY);

    expect<unknown>(first).toEqual({ kind: "found", record: upgraded, etag: after?.etag, upgrade: { from: 1, steps: ["rename text to title", "add an empty tag list"] } });
    expect(after?.value).toEqual(upgraded);
    expect(calls).toEqual({ reads: 1, writes: 1 });

    expect<unknown>(await readRecord(store, KEY, NOTE, NOTE_STEPS)).toEqual({ kind: "found", record: upgraded, etag: after?.etag });
    expect(calls).toEqual({ reads: 2, writes: 1 });
  });

  test("drift: two readers bringing one record up at once must end with one write, or the later one would undo a change made in between", async () => {
    const inner = counting(new MemoryStore());
    const store = racing(inner.store);
    await putRaw(inner.store, KEY, { shape: 1, revision: 5, text: "milk" });
    inner.calls.writes = 0;
    const upgraded = { shape: 3, revision: 6, title: "milk", tags: [] };

    const reads = await Promise.all([readRecord(store, KEY, NOTE, NOTE_STEPS), readRecord(store, KEY, NOTE, NOTE_STEPS)]);
    const after = await stored(inner.store, KEY);

    expect(reads.map((read) => (read.kind === "found" ? [read.record, read.etag, read.upgrade === undefined] : read))).toEqual(
      expect.arrayContaining([
        [upgraded, after?.etag, false],
        [upgraded, after?.etag, true],
      ]),
    );
    expect([after?.value, inner.calls.writes]).toEqual([upgraded, 2]);
  });

  test("drift: a step that fails must leave the stored bytes as they were and say which step it was, so a fixed release can run it again", async () => {
    const inner = new MemoryStore();
    const { store, calls } = counting(inner);
    const old = { shape: 1, revision: 5, text: "milk" };
    const etag = await putRaw(inner, KEY, old);

    expect<unknown>(await readRecord(store, KEY, NOTE, { note: [RENAME_TEXT, BROKEN_TAGS] })).toEqual({
      kind: "refused",
      refusal: { reason: "step-failed", stored: 1, from: 2, description: "add an empty tag list", message: "the tag list is unknown" },
    });
    expect([await stored(inner, KEY), calls]).toEqual([{ value: old, etag }, { reads: 1, writes: 0 }]);
  });

  test("drift: a shape with no step on the way is refused by name; skipping it would stamp a record with a shape it never reached", async () => {
    const store = new MemoryStore();
    await putRaw(store, KEY, { shape: 1, revision: 5, text: "milk" });

    expect<unknown>(await readRecord(store, KEY, NOTE, { note: [RENAME_TEXT] })).toEqual({ kind: "refused", refusal: { reason: "no-step", stored: 1, missing: 2 } });
    expect<unknown>(await readRecord(store, KEY, NOTE, {})).toEqual({ kind: "refused", refusal: { reason: "no-step", stored: 1, missing: 1 } });
  });

  test("drift: a record another writer never stops changing ends in a refusal after three reads, not in a loop that spends the request's storage calls", async () => {
    const { store, calls } = counting(new MemoryStore());
    await putRaw(store, KEY, { shape: 1, revision: 5, text: "milk" });
    const busy: ObjectStore = { ...store, writeIf: async () => ({ kind: "precondition-failed" }) };

    expect<unknown>(await readRecord(busy, KEY, NOTE, NOTE_STEPS)).toEqual({ kind: "refused", refusal: { reason: "contended", stored: 1 } });
    expect(calls.reads).toBe(3);
  });
});
