// One scheduled run of the sweep: as many steps of core's walk as fit one invocation's calls.
//
//   one step, at most      1 settings read + 1 listing + 5 x (1 read + 1 change + 30 bucket calls + 1 leftover forgotten) = 167 calls
//   a step of leftovers    1 settings read + 1 listing + 5 x (30 bucket calls + 1 leftover forgotten) + 1 removal of old logins = 158 calls
//   one run, at most       290 calls: a step starts only while 167 more still fit
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

/** The four parts of the walk, in its own order: the sites, the trash, the uploads, the leftovers. */
const PARTS: readonly Place[] = [{ trash: false }, { trash: true }, { uploads: true }, { leftovers: true }];

/** How long one part keeps the first turn; the cron trigger fires this often, so each run without a place to resume begins with the next part. */
const TURN_MS = 15 * 60 * 1000;

/** Where the walk stands, as one step answers it and the next takes it. */
export type Place = NonNullable<Parameters<typeof sweepExpired>[2]["from"]>;

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
 * Run the sweep for one scheduled invocation.
 *
 * @param from - where the run before stopped; absent, the run begins with the part whose turn it is at `scheduledTime`, so no part waits behind a long one forever
 * @returns where the next run goes on, or `undefined` once the walk reached its end
 * @throws {Error} the sweep was refused, or the database failed; what was moved or removed before stays so
 */
export async function runSweep(install: Install, scheduledTime: number, from?: Place): Promise<Place | undefined> {
  const tally = { calls: 0 };
  const watched: Install = { ...install, database: counted(install.database, tally), store: counted(install.store, tally) };
  let place = from ?? PARTS[Math.floor(scheduledTime / TURN_MS) % PARTS.length];

  while (place !== undefined && tally.calls + STEP_CALLS <= RUN_CALLS) {
    const swept = await sweepExpired(watched, SWEEPER, { limit: STEP_ITEMS, from: place });
    if (!swept.ok) throw new Error(`the sweep was refused: ${swept.code}`);

    place = swept.next;
  }

  return place;
}
