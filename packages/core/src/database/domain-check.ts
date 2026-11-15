// The statements that keep and read the last check or repair of the domain: one row, replaced by each run, which also remembers that the users changed since the last repair.

import { and, eq, sql as fragment } from "drizzle-orm";
import * as v from "valibot";

import { DOMAIN_CHECK, type DomainCheck, type RememberedCheck } from "../records/domain-check";
import { MOMENT } from "../records/fields";
import type { Statement, StatementResult } from "./driver";
import { domainCheck, settings } from "./schema";
import { BUILD, built, CHANGED } from "./statements";

/** The columns a new run replaces in the kept row. */
const REPLACED = [domainCheck.ran_at, domainCheck.ran_by, domainCheck.run, domainCheck.pieces] as const;

/**
 * Build the statement that reads the kept run.
 *
 * @returns one `SELECT` of the one row, its pieces as JSON text
 */
export function domainCheckAsked(): Statement {
  const { ran_at, ran_by, run, pieces, users_changed_at } = domainCheck;
  const columns = { ran_at, ran_by, run, pieces, users_changed_at };

  return built(BUILD.select(columns).from(domainCheck).where(eq(domainCheck.id, 1)));
}

/**
 * Build the statement that keeps a run in place of the one kept before. It changes exactly one row, which the audit entry written after it in the same batch relies on.
 *
 * @param settled - the moment up to which the run carried the users to the domain; a change of the users up to it waits no more. Left out, the run settles nothing
 * @throws {Error} a value of the run breaks its rule
 */
export function domainCheckKept(check: DomainCheck, settled?: number): Statement {
  const { ran_at, by, run, pieces } = v.parse(DOMAIN_CHECK, check);
  const row = { id: 1, ran_at, ran_by: by, run, pieces: JSON.stringify(pieces) };
  const replaced = Object.fromEntries(REPLACED.map((column) => [column.name, fragment`excluded.${fragment.identifier(column.name)}`]));
  if (settled === undefined) return built(BUILD.insert(domainCheck).values(row).onConflictDoUpdate({ target: domainCheck.id, set: replaced }));

  const waiting = fragment`CASE WHEN ${domainCheck.users_changed_at} > ${v.parse(MOMENT, settled)} THEN ${domainCheck.users_changed_at} END`;

  return built(BUILD.insert(domainCheck).values(row).onConflictDoUpdate({ target: domainCheck.id, set: { ...replaced, users_changed_at: waiting } }));
}

/**
 * Build the statement that remembers the users changed, for a batch where it follows the audit entry of that change: it writes only when that entry was written, and only on an install that keeps a run.
 *
 * @param at - the moment of the change
 */
export function usersChanged(at: number): Statement {
  return built(BUILD.update(domainCheck).set({ users_changed_at: at }).where(and(eq(domainCheck.id, 1), CHANGED)));
}

/**
 * Build the statement that remembers the users changed when the stored logins are replaced by a list, for a batch where it comes before that replacement: it compares the list with the logins still stored.
 * It writes only for a list that adds or drops a login, and only on an install that keeps a run. The same logins in another order are no change.
 *
 * @param logins - the logins that replace the stored ones
 * @param at - the moment of the change
 */
export function usersReplaced(logins: readonly string[], at: number): Statement {
  const stored = fragment`json_each(${settings.value}, '$.logins')`;
  const given = fragment`json_each(${JSON.stringify(logins)})`;
  const dropped = fragment`EXISTS (SELECT 1 FROM ${stored} AS was WHERE was.value NOT IN (SELECT value FROM ${given}))`;
  const added = fragment`EXISTS (SELECT 1 FROM ${given} AS now WHERE now.value NOT IN (SELECT value FROM ${stored}))`;
  const differs = fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1 AND (${dropped} OR ${added}))`;

  return built(BUILD.update(domainCheck).set({ users_changed_at: at }).where(and(eq(domainCheck.id, 1), differs)));
}

/**
 * Read the kept run out of what `domainCheckAsked` answered.
 *
 * @returns the run and when the users last changed with no repair after it, or `undefined` for no row and for a row that is no run
 */
export function domainCheckIn(result: StatementResult | undefined): RememberedCheck | undefined {
  const row = result?.rows[0];
  if (row === undefined || typeof row.pieces !== "string") return undefined;

  const check = v.safeParse(DOMAIN_CHECK, { ran_at: row.ran_at, by: row.ran_by, run: row.run, pieces: JSON.parse(row.pieces) });
  if (!check.success) return undefined;

  return { ...check.output, users_changed_at: typeof row.users_changed_at === "number" ? row.users_changed_at : null };
}
