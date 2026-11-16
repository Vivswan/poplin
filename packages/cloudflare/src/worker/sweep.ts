// One scheduled run of the sweep: the day's question about a newer version, the update an install with `auto_update` on starts by itself, then as many steps of core's walk as fit one invocation, from where the run before stopped.
//
//                        database calls                                                        other calls           in all
//   the run's start       1: the last asking, the settings, and the walk's place, read together  0                      1
//   the day's first run   2: that, and the answer written                                        1: the website asked   3
//   an update started     6: the address twice, the try, the answer, and the audit entry,        1: the build started   7
//                            or the try taken back and the problem noted
//   users that wait       1: the kept run of the domain read, on an install that holds a key           0                      1
//   users carried         6: that, 2 x (the mark set with the users read, the settling), a problem noted   8: 2 x 4 to Cloudflare 14
//   one step, at most    12: a listing of what is due, 5 x (a change, a leftover gone),          150: 5 x 30 to the bucket   162
//                            and the day's count of writes to the bucket, read before a run's first listing of it
//   a walk, nothing due   5: a listing each of the expired sites, the sat-out ones, the old      0                      5
//                            uploads, and the leftovers, and the logins that ran out removed
//   one run, at most     40: the start, the answer, an update, the steps, the count and the place written                290
//   one invocation       50: an instance that starts in it makes up to 10 before the run                                300
//
// D1 answers one invocation 50 queries on Cloudflare's Free plan, a batch being one. A run with nothing due makes 6, and 7 on an install that holds a key, however many sites the install holds.
// The settings are read once, at the start, and hold for the run. The walk's place is not written by a run whose walk began and ended in it.
// A run with nothing due writes no row, but the first run of a UTC day, which writes the one row of the answer.
// An update is started on the day's first run alone, and only where core's rules let it: every other run, and every install with the switch off, makes no call for it.
// A change of the users that did not reach Cloudflare is carried once a run, until it is settled.
// A run that listed the bucket adds its listings to the day's count in one row. It may list a thousand times a day beyond `max_storage_writes_per_day`, so no other work of a day keeps it from removing files.

import { startDueUpdate } from "@poplin/core/src/actions/auto-update";
import { type Asking, checkForUpdate } from "@poplin/core/src/actions/check-update";
import { meterNoted } from "@poplin/core/src/actions/problems";
import type { Install } from "@poplin/core/src/actions/records";
import type { Rebuilding } from "@poplin/core/src/actions/start-update";
import { SWEEP_SPARE_WRITES, SWEEPER, sweepExpired } from "@poplin/core/src/actions/sweep";
import { followUsers, type UsersFollow } from "@poplin/app/src/console/access/users-follow";

/** How many sites or uploads one step looks at. */
const STEP_ITEMS = 5;

/** The most calls one step can make, to the database and in all, as the table above adds them up. */
const STEP_CALLS = { database: 12, all: 162 } as const;

/** The most calls one run makes, which leaves an instance that starts first 10 of an invocation's 50 to the database and of its 300 in all. */
const RUN_CALLS = { database: 40, all: 290 } as const;

/** The database calls a run makes after its steps, which a step must leave room for: the write of the day's count and the write of the place. */
const CLOSING_CALLS = 2;

/** The most calls to Cloudflare one carrying of the users makes: the policy and the alert, each listed and written, for a list and for one that changed meanwhile. */
const FOLLOW_CALLS = 8;

/** Where a walk begins: at the sites that expired. The steps go on from there through the trash, the uploads, and the leftovers. */
const START: NonNullable<Place> = { trash: false };

/** Where the walk stands, as the database keeps it between two runs; `undefined` once it reached its end. */
type Place = Awaited<ReturnType<Install["database"]["readSweepPlace"]>>;

/** The version the install runs, what starts a build of it, and the users' side at Cloudflare. */
interface Running {
  readonly version: string;
  readonly rebuilding: Rebuilding;
  readonly follow: UsersFollow;
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

/** Carry the users to Cloudflare where a change of them still waits and the install holds a key to carry them with. A refusal leaves the change waiting for the next run. */
async function carryWaitingUsers(install: Install, follow: UsersFollow, tally: Tally): Promise<void> {
  if (!follow.holdsKey()) return;

  const waiting = (await install.database.readDomainCheck())?.users_changed_at ?? null;
  if (waiting === null) return;

  tally.web += FOLLOW_CALLS;
  await followUsers(install, follow);
}

/**
 * Run the sweep for one scheduled invocation: go on where the run before stopped, and keep where this one stops.
 *
 * The place is kept in the database, since Cloudflare may start a new instance for every run. Only what is due is looked at: a run takes 5 due items when each takes a whole removal, and 25 when each takes one change.
 * The first run of a UTC day also writes which version of poplin is the newest, and may start an update: either leaves the steps fewer calls.
 *
 * @param asking - what sends the day's one request for the newest version, and where to
 * @param running - the version the install runs and what starts a build of it, for the update an install starts by itself, and the users' side at Cloudflare
 * @throws {Error} the sweep was refused, or the database failed; what was moved or removed before stays so, and the next run begins where this one began
 */
export async function runSweep(install: Install, asking: Asking, running: Running): Promise<void> {
  const tally: Tally = { database: 0, bucket: 0, web: 0 };
  const database = counted(install.database, tally, "database");
  const meter = meterNoted({ ...install, database }, SWEEP_SPARE_WRITES);
  const start = await database.readSweepStart();
  const settled = start.settings === undefined ? {} : { knownSettings: start.settings };
  const watched: Install = { ...install, ...settled, database, store: counted(meter.store, tally, "bucket") };
  const learned = await checkForUpdate(watched, counted(asking, tally, "web"), { last: start.updateCheck });
  const rebuilding = { ...running.rebuilding, fetch: counted({ fetch: running.rebuilding.fetch }, tally, "web").fetch };
  if (learned !== undefined) await startDueUpdate(watched, { ...learned, version: running.version }, rebuilding);
  await carryWaitingUsers(watched, running.follow, tally);

  let place: Place = start.place ?? START;

  try {
    while (place !== undefined && fitsAnotherStep(tally)) {
      const swept = await sweepExpired(watched, SWEEPER, { limit: STEP_ITEMS, from: place });
      if (!swept.ok) throw new Error(`the sweep was refused: ${swept.code}`);

      place = swept.next;
    }
  } finally {
    await meter.settle();
  }

  // A walk that began and ended inside this run left no place to keep, and none was kept before it.
  if (place !== undefined || start.place !== undefined) await watched.database.keepSweepPlace(place);
}
