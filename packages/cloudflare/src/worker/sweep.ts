// One scheduled run of the sweep: as many steps of core's walk as fit one invocation, from where the run before stopped.
//
//                        database calls                                                        bucket calls   in all
//   one step, at most    17: the settings, a listing, 5 x (a read, a change, a leftover gone)   150: 5 x 30    167
//   sites, none due       2: the settings, a listing                                              0              2
//   one run, at most     40: the walk's place read, the steps, the place written                                290
//   one invocation       50: an instance that starts in it makes up to 10 before the run                        300
//
// D1 answers one invocation 50 queries on Cloudflare's Free plan, a batch being one.

import type { Install } from "@poplin/core/src/actions/records";
import { SWEEPER, sweepExpired } from "@poplin/core/src/actions/sweep";

/** How many sites or uploads one step looks at. */
const STEP_ITEMS = 5;

/** The most calls one step can make, to the database and in all, as the table above adds them up. */
const STEP_CALLS = { database: 17, all: 167 } as const;

/** The most calls one run makes, which leaves an instance that starts first 10 of an invocation's 50 to the database and of its 300 in all. */
const RUN_CALLS = { database: 40, all: 290 } as const;

/** The database calls a run makes after its steps, which a step must leave room for: the write of the place. */
const PLACE_CALLS = 1;

/** Where a walk begins: at the newest site. The steps go on from there through the trash, the uploads, and the leftovers. */
const START: NonNullable<Place> = { trash: false };

/** Where the walk stands, as the database keeps it between two runs; `undefined` once it reached its end. */
type Place = Awaited<ReturnType<Install["database"]["readSweepPlace"]>>;

/** The calls a run has made so far. A call to the database is one query to D1. */
interface Tally {
  database: number;
  bucket: number;
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
  const database = tally.database + STEP_CALLS.database + PLACE_CALLS;
  const all = tally.database + tally.bucket + STEP_CALLS.all + PLACE_CALLS;

  return database <= RUN_CALLS.database && all <= RUN_CALLS.all;
}

/**
 * Run the sweep for one scheduled invocation: go on where the run before stopped, and keep where this one stops.
 *
 * The place is kept in the database, since Cloudflare may start a new instance for every run. A run looks at 55 items when none is due and at 5 when each takes a whole removal, so every site, upload, and leftover is reached within one run for every 5.
 *
 * @throws {Error} the sweep was refused, or the database failed; what was moved or removed before stays so, and the next run begins where this one began
 */
export async function runSweep(install: Install): Promise<void> {
  const tally: Tally = { database: 0, bucket: 0 };
  const watched: Install = { ...install, database: counted(install.database, tally, "database"), store: counted(install.store, tally, "bucket") };
  let place: Place = (await watched.database.readSweepPlace()) ?? START;

  while (place !== undefined && fitsAnotherStep(tally)) {
    const swept = await sweepExpired(watched, SWEEPER, { limit: STEP_ITEMS, from: place });
    if (!swept.ok) throw new Error(`the sweep was refused: ${swept.code}`);

    place = swept.next;
  }

  await watched.database.keepSweepPlace(place);
}
