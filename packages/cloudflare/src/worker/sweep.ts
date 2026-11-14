// One scheduled run of the sweep: as many steps of core's walk as fit one invocation's calls, from where the run before stopped.
//
//   one step, at most      1 settings read + 1 listing + 5 x (1 read + 1 change + 30 bucket calls + 1 leftover forgotten) = 167 calls
//   a step of leftovers    1 settings read + 1 listing + 5 x (30 bucket calls + 1 leftover forgotten) + 1 removal of old logins = 158 calls
//   one run, at most       290 calls: 1 read of the walk's place, the steps, and 1 write of the place; a step starts only while 167 more and the write still fit
//   one invocation         300 calls: an instance that starts in it makes up to 10 before the run
//   a run with nothing to remove costs 7 calls a step, so it looks at about 90 sites or uploads
//
// Cloudflare's Free plan gives one invocation 1,000 calls to its own services and a cron run 10 ms of CPU; the run stays under a third of the first, since the second is the tighter one.

import type { Install } from "@poplin/core/src/actions/records";
import { SWEEPER, sweepExpired } from "@poplin/core/src/actions/sweep";

/** How many sites or uploads one step looks at. */
const STEP_ITEMS = 5;

/** The most database and bucket calls one step can make, as the table above adds them up. */
const STEP_CALLS = 167;

/** The most database and bucket calls one run makes, which leaves 10 of an invocation's 300 to an instance that starts first. */
const RUN_CALLS = 290;

/** The calls a run makes around its steps that a step must leave room for: the write of the place. */
const PLACE_CALLS = 1;

/** Where a walk begins: at the newest site. The steps go on from there through the trash, the uploads, and the leftovers. */
const START: NonNullable<Place> = { trash: false };

/** Where the walk stands, as the database keeps it between two runs; `undefined` once it reached its end. */
type Place = Awaited<ReturnType<Install["database"]["readSweepPlace"]>>;

/** Wrap a database or a bucket so every call of a method of it is counted. */
function counted<Target extends object>(target: Target, tally: { calls: number }): Target {
  return new Proxy(target, {
    get(inner, name) {
      const member: unknown = Reflect.get(inner, name, inner);
      if (typeof member !== "function") return member;

      return (...given: unknown[]): unknown => {
        tally.calls += 1;

        return Reflect.apply(member, inner, given);
      };
    },
  });
}

/**
 * Run the sweep for one scheduled invocation: go on where the run before stopped, and keep where this one stops.
 *
 * The place is kept in the database, since Cloudflare may start a new instance for every run. A walk takes one run for about every 90 items, and the next walk begins when one ends, so every site, upload, and leftover is looked at within that many runs.
 *
 * @throws {Error} the sweep was refused, or the database failed; what was moved or removed before stays so, and the next run begins where this one began
 */
export async function runSweep(install: Install): Promise<void> {
  const tally = { calls: 0 };
  const watched: Install = { ...install, database: counted(install.database, tally), store: counted(install.store, tally) };
  let place: Place = (await watched.database.readSweepPlace()) ?? START;

  while (place !== undefined && tally.calls + STEP_CALLS + PLACE_CALLS <= RUN_CALLS) {
    const swept = await sweepExpired(watched, SWEEPER, { limit: STEP_ITEMS, from: place });
    if (!swept.ok) throw new Error(`the sweep was refused: ${swept.code}`);

    place = swept.next;
  }

  await watched.database.keepSweepPlace(place);
}
