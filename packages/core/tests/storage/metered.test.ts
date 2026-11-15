import { describe, expect, test } from "bun:test";

import { MemoryStore } from "../../src/storage/memory";
import { meterStore, WritesSpent } from "../../src/storage/metered";
import { bytesOf, objectKey } from "./support/storage-contract";

const NOW = Date.UTC(2026, 10, 13, 22);
const TODAY = "2026-11-13";
const TEXT = { contentType: "text/plain" } as const;

/** A day with room for so many more, with every place asked of it and every addition to it noted. */
function dayWith(room: number): { readonly database: Parameters<typeof meterStore>[1]["database"]; readonly asked: unknown[]; readonly added: unknown[] } {
  const asked: unknown[] = [];
  const added: unknown[] = [];

  return {
    asked,
    added,
    database: {
      takeStorageWrite: async (day, spare) => {
        asked.push([day, spare]);

        return asked.length <= room + spare;
      },
      addStorageWrites: async (day, writes) => void added.push([day, writes]),
    },
  };
}

/** A store that notes how often it is listed. */
function listedStore(): { readonly store: MemoryStore; readonly listed: () => number } {
  const store = new MemoryStore();
  const list = store.list.bind(store);
  let listed = 0;
  store.list = (options) => {
    listed += 1;

    return list(options);
  };

  return { store, listed: () => listed };
}

describe("meterStore", () => {
  // Drift: a host bills every listing of its store. A listing left uncounted would pass the day's bound unseen, and one that cost the database a call each would run a removal of many pages out of the calls a request gets.
  test("the first listing takes its place in the day's count before it is made, and the ones after it are written once", async () => {
    const day = dayWith(10);
    const meter = meterStore(new MemoryStore(), { database: day.database, now: () => NOW });
    for (let listed = 0; listed < 3; listed += 1) await meter.store.list({ prefix: "blog/" });
    await meter.settle();
    await meter.settle();

    expect({ asked: day.asked, added: day.added }).toEqual({ asked: [[TODAY, 0]], added: [[TODAY, 2]] });
  });

  // Drift: a file of a publish is one request each. A meter that asked the database for a request that lists nothing would cost a publish a call a file.
  test("a request that writes, reads, and deletes, and lists nothing, asks the database nothing", async () => {
    const day = dayWith(10);
    const meter = meterStore(new MemoryStore(), { database: day.database, now: () => NOW });
    const key = objectKey("blog/v1/index.html");
    await meter.store.write(key, bytesOf("home"), TEXT);
    await meter.store.head(key);
    await meter.store.read(key);
    await meter.store.deleteMany([key]);
    await meter.store.delete(key);
    await meter.settle();

    expect({ asked: day.asked, added: day.added }).toEqual({ asked: [], added: [] });
  });

  // Drift: the bound is what keeps a month inside what a host takes for free. A refusal that still listed, or a later listing let through after one was refused, would make the bound a number nobody keeps.
  test.each([
    ["a day with no room refuses every listing of a request, and lists nothing", 0, undefined, ["spent", "spent"], 0],
    ["a day with no room still takes a caller's spare listing, and the ones that follow it", 0, 1, ["listed", "listed"], 2],
    ["a day with room takes the first listing and the ones that follow it", 1, undefined, ["listed", "listed"], 2],
  ] as const)("%s", async (_name, room, spare, answers, listed) => {
    const day = dayWith(room);
    const inner = listedStore();
    const meter = meterStore(inner.store, { database: day.database, now: () => NOW, ...(spare === undefined ? {} : { spare }) });
    const got: string[] = [];
    for (const _asked of answers) got.push(await meter.store.list({ prefix: "blog/" }).then(() => "listed", (error: unknown) => (error instanceof WritesSpent ? "spent" : "failed")));
    await meter.settle();

    expect({ got, listed: inner.listed(), asked: day.asked.length, added: day.added }).toEqual({ got: [...answers], listed, asked: 1, added: listed > 1 ? [[TODAY, listed - 1]] : [] });
  });
});
