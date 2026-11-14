import { describe, expect, test } from "bun:test";

import { writeRecord } from "../src/records/write";
import { MemoryStore } from "../src/storage/memory";
import { NOTE, type Note, noteKey, stored } from "./note-kind";

const KEY = noteKey("list");
const FIELDS = { title: "milk", tags: ["shop"] };

describe("writeRecord", () => {
  test("drift: a record rewritten with equal content must still change in bytes, or a writer holding the old etag would pass its condition", async () => {
    const store = new MemoryStore();

    const created = await writeRecord(store, KEY, NOTE, FIELDS, "absent");
    if (created.kind !== "written") throw new Error("the fixture was not created");

    const again = await writeRecord(store, KEY, NOTE, FIELDS, { revision: created.record.revision, etag: created.etag });
    if (again.kind !== "written") throw new Error("the fixture was not rewritten");

    const stale = await writeRecord(store, KEY, NOTE, { title: "bread", tags: [] }, { revision: created.record.revision, etag: created.etag });

    expect([created.record, again.record, again.etag === created.etag, stale]).toEqual([{ shape: 3, revision: 1, ...FIELDS }, { shape: 3, revision: 2, ...FIELDS }, false, { kind: "conflict" }]);
    expect(await stored(store, KEY)).toEqual({ value: { shape: 3, revision: 2, ...FIELDS }, etag: again.etag });
  });

  test("drift: creating a record over one that exists must be a conflict, or two publishers of one name would each believe they own it", async () => {
    const store = new MemoryStore();
    await writeRecord(store, KEY, NOTE, FIELDS, "absent");

    expect<unknown>(await writeRecord(store, KEY, NOTE, { title: "bread", tags: [] }, "absent")).toEqual({ kind: "conflict" });
  });

  test("drift: the stamp and the counter are the writer's alone; fields that bring their own or break the schema must never reach the store", async () => {
    const store = new MemoryStore();
    const forged = { ...FIELDS, shape: 1, revision: 40 } as Omit<Note, "shape" | "revision">;
    const broken = { title: "milk" } as Omit<Note, "shape" | "revision">;

    const invalid = await writeRecord(store, KEY, NOTE, broken, "absent");
    const missing = await stored(store, KEY);
    const stamped = await writeRecord(store, KEY, NOTE, forged, "absent");

    expect<unknown>([invalid, missing]).toEqual([{ kind: "invalid", issues: ['tags: Invalid key: Expected "tags" but received undefined'] }, undefined]);
    expect(stamped.kind === "written" && stamped.record).toEqual({ shape: 3, revision: 1, ...FIELDS });
  });
});
