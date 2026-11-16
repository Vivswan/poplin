// One scheduled run of the sweep: the day's question about a newer version, the update an install with `auto_update` on starts by itself, then as many steps of core's walk as fit one invocation, from where the run before stopped.
//
//                        database calls                                                        other calls           in all
//   the newer version     1: the last asking read                                                0                      1
//   the day's first run   3: that, the settings, the answer written                              1: the website asked   4
//   an update started     7: the address twice, the try, the settings, the answer, and the       1: the build started   8
//                            audit entry, or the try taken back and the problem noted
//   one step, at most    18: the settings, a listing, 5 x (a read, a change, a leftover gone),   150: 5 x 30 to the bucket   168
//                            and the day's count of writes to the bucket, read before a run's first listing of it
//   sites, none due       2: the settings, a listing                                              0                      2
//   one run, at most     40: the question, the start, the walk's place read, the steps, the count and the place written  290
//   one invocation       50: an instance that starts in it makes up to 10 before the run                                300
//
// D1 answers one invocation 50 queries on Cloudflare's Free plan, a batch being one.
// A run with nothing due writes no row, but the first run of a UTC day, which writes the one row of the answer.
// An update is started on the day's first run alone, and only where core's rules let it: every other run, and every install with the switch off, makes no call for it.
// A run that listed the bucket adds its listings to the day's count in one row. It may list a thousand times a day beyond `max_storage_writes_per_day`, so no other work of a day keeps it from removing files.

import { startDueUpdate } from "@poplin/core/src/actions/auto-update";
import { type Asking, checkForUpdate } from "@poplin/core/src/actions/check-update";
import { meterNoted } from "@poplin/core/src/actions/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { Rebuilding } from "@poplin/core/src/actions/start-update";
import { SWEEP_SPARE_WRITES, SWEEPER, sweepExpired } from "@poplin/core/src/actions/sweep";

/** How many sites or uploads one step looks at. */
const STEP_ITEMS = 5;

/** The most calls one step can make, to the database and in all, as the table above adds them up. */
const STEP_CALLS = { database: 18, all: 168 } as const;

/** The most calls one run makes, which leaves an instance that starts first 10 of an invocation's 50 to the database and of its 300 in all. */
const RUN_CALLS = { database: 40, all: 290 } as const;

/** The database calls a run makes after its steps, which a step must leave room for: the write of the day's count and the write of the place. */
const CLOSING_CALLS = 2;

/** Where a walk begins: at the newest site. The steps go on from there through the trash, the uploads, and the leftovers. */
const START: NonNullable<Place> = { trash: false };

/** Where the walk stands, as the database keeps it between two runs; `undefined` once it reached its end. */
type Place = Awaited<ReturnType<Install["database"]["readSweepPlace"]>>;

/** The version the install runs, and what starts a build of it. */
interface Running {
  readonly version: string;
  readonly rebuilding: Rebuilding;
}

/** The calls a run has made so far. A call to the database is one query to D1, and one to the web is the request for the newest version or the one that starts a build. */
interface Tally {
  database: number;
  bucket: number;
  web: number;
}

/** Wrap a database or a bucket so every call of a method of it is counted under its name. */
function counted<Target extends object>(target: Target, tally: Tally, under: keyof Tally): Target {
  return new Proxy(target, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (typeof member !== "function") return member;

      return (...given: unknown[]): unknown => {
        tally[under] += 1;

        return Reflect.apply(member, inner, given);
      };
    },
  });
}

/** Whether a whole step and the write of the place still fit the run, by the database's calls and by all of them. */
function fitsAnotherStep(tally: Tally): boolean {
  const database = tally.database + STEP_CALLS.database + CLOSING_CALLS;
  const all = tally.database + tally.bucket + tally.web + STEP_CALLS.all + CLOSING_CALLS;

  return database <= RUN_CALLS.database && all <= RUN_CALLS.all;
}

/**
 * Run the sweep for one scheduled invocation: go on where the run before stopped, and keep where this one stops.
 *
 * The place is kept in the database, since Cloudflare may start a new instance for every run. A run looks at 50 items when none is due and at 5 when each takes a whole removal, so every site, upload, and leftover is reached within one run for every 5.
 * The first run of a UTC day looks at 45, since it also asks which version of poplin is the newest, and at 30 when it starts an update as well.
 *
 * @param asking - what sends the day's one request for the newest version, and where to
 * @param running - the version the install runs and what starts a build of it, for the update an install starts by itself
 * @throws {Error} the sweep was refused, or the database failed; what was moved or removed before stays so, and the next run begins where this one began
 */
export async function runSweep(install: Install, asking: Asking, running: Running): Promise<void> {
  const tally: Tally = { database: 0, bucket: 0, web: 0 };
  const database = counted(install.database, tally, "database");
  const meter = meterNoted({ ...install, database }, SWEEP_SPARE_WRITES);
  const watched: Install = { ...install, database, store: counted(meter.store, tally, "bucket") };
  const learned = await checkForUpdate(watched, counted(asking, tally, "web"));
  const rebuilding = { ...running.rebuilding, fetch: counted({ fetch: running.rebuilding.fetch }, tally, "web").fetch };
  if (learned !== undefined) await startDueUpdate(watched, { ...learned, version: running.version }, rebuilding);

  let place: Place = (await watched.database.readSweepPlace()) ?? START;

  try {
    while (place !== undefined && fitsAnotherStep(tally)) {
      const swept = await sweepExpired(watched, SWEEPER, { limit: STEP_ITEMS, from: place });
      if (!swept.ok) throw new Error(`the sweep was refused: ${swept.code}`);

      place = swept.next;
    }
  } finally {
    await meter.settle();
  }

  await watched.database.keepSweepPlace(place);
}
