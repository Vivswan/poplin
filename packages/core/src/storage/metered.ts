// A store that counts its listings against the day's bound on the times the store is written to or listed.
//
//   list             counted, and refused once the day's count has reached the bound
//   write            not counted here: an upload's writes are counted when it begins, and one that fails where it fails
//   head, read       not counted: reads have a bound of their own
//   delete           not counted: a store takes them for free
//
// The first listing takes its place in the day's count before it is made, in one step with the check, so requests that arrive together cannot pass the bound together.
// The listings after it are counted once, by `settle`: each is a further page of what the first one began, a thousand files a page.

import type { Database } from "../database/database";
import { dayOf } from "../records/views";
import type { ListOptions, ListPage, ObjectStore } from "./storage";

/** What the meter is built from. */
interface Parts {
  /** Where the day's count is kept. */
  readonly database: Pick<Database, "takeStorageWrite" | "addStorageWrites">;

  /** The clock, in milliseconds since the epoch: the day everything is counted on is the one the meter is made on. */
  readonly now: () => number;

  /** How many listings beyond the setting's bound are taken; 0 when left out. The scheduled sweep has some, so no other work of a day keeps it from removing files. */
  readonly spare?: number;
}

/** A store that counts, and what writes its count down. */
interface Metered {
  /** The store, every call passed on as it is. */
  readonly store: ObjectStore;

  /** Add the listings made after the first, and since the last call, to the day's count. It writes nothing when there are none. */
  readonly settle: () => Promise<void>;
}

/** What a listing throws once the day's count of writes and listings has reached its bound. Nothing was listed, and no later listing of the same meter is; the same call works again from the next midnight UTC. */
export class WritesSpent extends Error {
  constructor() {
    super("the day's writes to the store are used up");
    this.name = "WritesSpent";
  }
}

/**
 * Wrap a store so its listings are counted against the day's bound.
 *
 * @returns the store and `settle`, which whoever made the meter calls once the work is done, whether it failed or not
 */
export function meterStore(inner: ObjectStore, parts: Parts): Metered {
  const day = dayOf(parts.now());
  let later = 0;
  let settled = 0;
  let first: Promise<boolean> | undefined;

  const store: ObjectStore = {
    head: (key) => inner.head(key),
    read: (key, options) => inner.read(key, options),
    write: (key, body, options) => inner.write(key, body, options),
    delete: (key) => inner.delete(key),
    deleteMany: (keys) => inner.deleteMany(keys),

    async list(options: ListOptions): Promise<ListPage> {
      const counted = first !== undefined;
      first ??= parts.database.takeStorageWrite(day, parts.spare ?? 0);
      if (!(await first)) throw new WritesSpent();

      if (counted) later += 1;

      return inner.list(options);
    },
  };

  const settle = async (): Promise<void> => {
    const writes = later - settled;
    if (writes === 0) return;

    settled = later;
    await parts.database.addStorageWrites(day, writes);
  };

  return { store, settle };
}
