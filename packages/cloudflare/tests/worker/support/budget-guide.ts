// What the actions a person does cost: the rows of the budget table that the guide names an action for, added up by that action.

import type { CostLine } from "./budget-stage";

/** The counts of one action, in the order the guide's table holds them after the action's name. */
export const ACTION_COUNTS = ["requests", "queries", "read", "written", "reads", "writes"] as const;

/** What one action costs: how many requests it is, and what they ask of the database and the bucket together. `reads` are the bucket's gets and heads, `writes` its puts and listings. */
export type ActionCost = Readonly<Record<(typeof ACTION_COUNTS)[number], number>>;

/** What one row adds to its action. */
function costOfLine(line: CostLine): ActionCost {
  return { requests: 1, queries: line.queries, read: line.read, written: line.written, reads: line.gets + line.heads, writes: line.puts + line.lists };
}

/**
 * Add the rows up by the action of the guide each is a request of.
 *
 * @returns what each action costs, in the order the rows first name them; a row that names none is left out
 */
export function actionCosts(lines: readonly CostLine[]): Map<string, ActionCost> {
  const sums = new Map<string, ActionCost>();
  for (const line of lines) {
    if (line.guide === undefined) continue;

    const so = sums.get(line.guide);
    const adds = costOfLine(line);
    sums.set(line.guide, so === undefined ? adds : (Object.fromEntries(ACTION_COUNTS.map((count) => [count, so[count] + adds[count]])) as ActionCost));
  }

  return sums;
}
