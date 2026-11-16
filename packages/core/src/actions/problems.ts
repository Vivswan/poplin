// What the install remembers of what went wrong: noting a problem, ending one that was mended, and listing the problems of the last days.
//
//   the first of a kind in an hour of the clock    one statement: the day's row is made or added to
//   every later one, in the same instance          nothing is asked: it is counted here and added by the next write
//   one another instance wrote first in that hour  one statement that changes nothing; it is counted here the same way
//   a limit of a day                               one row on the day it is reached, and nothing after
//
// So a storm costs one row an hour for each kind, and its count runs behind: an instance that stops takes what it counted with it.
// `more` marks a row that was added to from such a count.

import * as v from "valibot";

import type { Actor } from "../auth/scopes";
import type { Database } from "../database/database";
import { AllowanceSpent } from "../database/driver";
import { type CarriedUsers, type CheckedPiece, type DomainCheck, keptPieces, mendsOf } from "../records/domain-check";
import { endedBy, type Mend, PROBLEM, PROBLEM_DAYS_KEPT, type ProblemKind } from "../records/problem";
import { problemDetail } from "../records/problem-detail";
import { dayOf, daysUpTo } from "../records/views";
import { meterStore } from "../storage/metered";
import { type Install, type Refused, refuse } from "./records";

/** The milliseconds of one hour. */
const HOUR_MS = 3_600_000;

/** What each instance knows of the kinds it noted, by the database it noted them in. */
const NOTED = new WeakMap<Database, Map<ProblemKind, Noted>>();

/** How many days back a listing may go: a whole number from 1 to the days kept. */
const DAYS = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(PROBLEM_DAYS_KEPT));

/** What the list answers: the UTC day it was read on, and the problems of the days asked for. */
export const PROBLEMS_LISTED = v.object({ today: v.pipe(v.string(), v.isoDate()), problems: v.array(PROBLEM) });

/** The last hour of the clock a kind was noted in, and the tries since that no row holds yet. */
interface Noted {
  readonly hour: number;
  readonly missed: number;
}

/**
 * Note that something went wrong. It never throws: a note that cannot be written is given up, so noting a problem never makes a second one.
 *
 * It asks the database at most once per kind and hour of the clock, and writes at most one row then.
 *
 * @param failure - whatever was thrown, where something was: its name and its cleaned message are kept, and nothing else of it. A day's allowance of the database used up is no problem to note
 */
export async function noteProblem(install: Pick<Install, "database" | "now">, kind: ProblemKind, failure?: unknown): Promise<void> {
  // A database that takes no more for the day takes no note either.
  if (failure instanceof AllowanceSpent) return;

  const at = install.now();
  const hour = Math.floor(at / HOUR_MS);
  const kinds = NOTED.get(install.database) ?? new Map<ProblemKind, Noted>();
  const before = kinds.get(kind);
  NOTED.set(install.database, kinds);

  if (before?.hour === hour) {
    kinds.set(kind, { hour, missed: before.missed + 1 });

    return;
  }

  // A try counted on an earlier day belongs to no row of this one.
  const missed = before !== undefined && dayOf(before.hour * HOUR_MS) === dayOf(at) ? before.missed : 0;
  // Set before the write, so the tries that arrive while it runs ask nothing.
  kinds.set(kind, { hour, missed: 0 });

  const write = async (): Promise<boolean> => install.database.noteProblem({ kind, at, count: 1 + missed, more: missed > 0, ...problemDetail(failure) });
  const written = await write().catch(() => false);
  const since = kinds.get(kind);
  // A note of a later hour may have gone through meanwhile: its guard stands.
  if (written || since?.hour !== hour) return;

  kinds.set(kind, { hour, missed: since.missed + 1 + missed });
}

/** Forget, in this instance, that the kinds some mends end were noted in this hour: their rows are gone, so the next of them writes one. */
function forgetEnded(database: Database, mends: readonly Mend[]): void {
  for (const kind of endedBy(mends)) NOTED.get(database)?.delete(kind);
}

/**
 * End the problems some mends end, of today and the day before, where no run of the domain is kept with them. `endedBy` says which kinds each mend ends.
 *
 * @throws whatever the database rejects with
 */
export async function endProblems(install: Pick<Install, "database" | "now">, mends: readonly Mend[]): Promise<void> {
  await install.database.endProblems(mends, install.now());
  forgetEnded(install.database, mends);
}

/**
 * Keep a run of the domain as the last check, and end the problems it shows as mended, in one step of the database.
 *
 * @param run - the run with every piece it read: what it mends is told from all of them, and the pieces are cut to what is kept after that
 * @param detail - what the audit entry says of the run; `null` writes no entry
 * @param carried - for a repair that wrote the users to the domain: what it came to, as `keepDomainCheck` takes it
 * @throws whatever the database rejects with
 */
export async function keepDomainRun(
  install: Pick<Install, "database">,
  run: Omit<DomainCheck, "pieces"> & { readonly pieces: readonly CheckedPiece[] },
  detail: Readonly<Record<string, unknown>> | null,
  carried?: CarriedUsers,
): Promise<void> {
  const mends = mendsOf(run);
  await install.database.keepDomainCheck({ ...run, pieces: keptPieces(run.pieces) }, detail, carried, mends);
  forgetEnded(install.database, mends);
}

/**
 * Wrap an install's store so its listings are counted against the day's bound, as `meterStore` does, and what goes wrong with the count is noted.
 *
 * @param spare - how many listings beyond the setting's bound are taken; 0 when left out
 * @returns the store, which notes the day's limit as reached before it refuses a listing, and `settle`, which notes a count that could not be written and then throws what the database rejected it with
 */
export function meterNoted(install: Pick<Install, "database" | "store" | "now">, spare = 0): ReturnType<typeof meterStore> {
  const meter = meterStore(install.store, { database: install.database, now: install.now, spare, refused: () => noteProblem(install, "writes_limit_reached") });
  const settle = async (): Promise<void> => {
    try {
      await meter.settle();
    } catch (error) {
      await noteProblem(install, "count_unwritten", error);

      throw error;
    }
  };

  return { store: meter.store, settle };
}

/**
 * List what went wrong in the last days, the kind last seen first. It is one read of the database.
 *
 * @param days - how many UTC days back, today included: 1 to 30
 * @returns the UTC day of the reading, and one entry per kind and day. `not_allowed` for anyone but an admin, and `bad_argument` about `days` for a number that is no such count
 */
export async function listProblems(
  install: Pick<Install, "database" | "now">,
  actor: Actor,
  days: number,
): Promise<({ readonly ok: true } & Readonly<v.InferOutput<typeof PROBLEMS_LISTED>>) | Refused<"not_allowed" | "bad_argument">> {
  if (actor.scope !== "admin") return refuse("not_allowed");

  const asked = v.safeParse(DAYS, days);
  if (!asked.success) return refuse("bad_argument", "days");

  const today = dayOf(install.now());
  const [since] = daysUpTo(today, asked.output);

  return { ok: true, today, problems: [...(await install.database.listProblems(since ?? today))] };
}
