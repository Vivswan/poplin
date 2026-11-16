// The statements that note what went wrong, list it, and forget its old days.
//
// A kind is written once per hour of the clock, and that rule is in the statement itself: of every instance that notes a kind in one hour, only the first writes a row.

import { gte, lt, sql as fragment } from "drizzle-orm";
import * as v from "valibot";

import { MOMENT, POSITIVE } from "../records/fields";
import { MOST_MESSAGE_LENGTH, MOST_NAME_LENGTH, ONCE_A_DAY, PROBLEM, PROBLEM_DAYS_KEPT, PROBLEM_KINDS, type Problem } from "../records/problem";
import { dayOf, daysUpTo } from "../records/views";
import type { Statement, StatementResult } from "./driver";
import { problems } from "./schema";
import { BUILD, built } from "./statements";

/** The milliseconds of one hour. */
const HOUR_MS = 3_600_000;

/** What one noting of a problem holds. */
const PROBLEM_NOTE = v.object({
  kind: v.picklist(PROBLEM_KINDS),
  at: MOMENT,
  count: POSITIVE,
  more: v.boolean(),
  name: v.nullable(v.pipe(v.string(), v.maxLength(MOST_NAME_LENGTH))),
  message: v.nullable(v.pipe(v.string(), v.maxLength(MOST_MESSAGE_LENGTH))),
});

/** One noting of a problem: `count` is how many tries it stands for, and `more` whether some of them were held in memory before it. */
export type ProblemNote = Readonly<v.InferOutput<typeof PROBLEM_NOTE>>;

/**
 * Build the statement that notes a problem on the UTC day of its moment.
 *
 * @returns one `INSERT` that makes the day's row of the kind, or adds to it when the row was last written in an earlier hour of the clock. In the same hour it changes nothing.
 *   A kind noted once a day is one row that counts 1, whatever the note counts, and nothing changes it
 * @throws {Error} a value of the note breaks its rule
 */
export function problemNoted(note: ProblemNote): Statement {
  const { kind, at, count, more, name, message } = v.parse(PROBLEM_NOTE, note);
  const row = { day: dayOf(at), kind, first_at: at, last_at: at, name, message };
  if (ONCE_A_DAY.has(kind)) return built(BUILD.insert(problems).values({ ...row, count: 1, more: 0 }).onConflictDoNothing());

  const insert = BUILD.insert(problems).values({ ...row, count, more: Number(more) });

  const added = {
    count: fragment`${problems.count} + excluded.count`,
    more: fragment`max(${problems.more}, excluded.more)`,
    last_at: fragment`excluded.last_at`,
    name: fragment`excluded.name`,
    message: fragment`excluded.message`,
  };
  const laterHour = fragment`excluded.last_at / ${fragment.raw(String(HOUR_MS))} > ${problems.last_at} / ${fragment.raw(String(HOUR_MS))}`;

  return built(insert.onConflictDoUpdate({ target: [problems.day, problems.kind], set: added, setWhere: laterHour }));
}

/**
 * Build the statement that lists the problems from a UTC day on.
 *
 * @param since - the first day listed, such as `2026-11-13`
 * @returns one `SELECT` in the order of the key: a sort would read every row a second time
 */
export function problemsAsked(since: string): Statement {
  return built(BUILD.select().from(problems).where(gte(problems.day, since)));
}

/** Build the statement that forgets every problem of a day before the days kept, counted back from a moment. */
export function problemsForgotten(now: number): Statement {
  const [first] = daysUpTo(dayOf(now), PROBLEM_DAYS_KEPT);

  return built(BUILD.delete(problems).where(lt(problems.day, first ?? dayOf(now))));
}

/**
 * Read the problems out of what `problemsAsked` answered.
 *
 * @returns the problems, the one last seen first and those of one moment by their kind; a row that is no problem is left out
 */
export function problemsIn(result: StatementResult | undefined): Problem[] {
  const read: Problem[] = [];

  for (const row of result?.rows ?? []) {
    const problem = v.safeParse(PROBLEM, { ...row, more: row.more === 1 });
    if (problem.success) read.push(problem.output);
  }

  return read.sort((one, other) => other.last_at - one.last_at || one.kind.localeCompare(other.kind));
}
