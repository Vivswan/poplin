// The statements that keep and read the last check or repair of the domain: one row, replaced by each run, which also remembers that the users changed and the change has not reached the domain.

import { and, eq, sql as fragment } from "drizzle-orm";
import * as v from "valibot";

import { type CarriedUsers, DOMAIN_CHECK, type DomainCheck, type RememberedCheck } from "../records/domain-check";
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
 * Build the statement that keeps a run in place of the one kept before. It changes exactly one row, which the audit entry written after it in the same batch relies on, and leaves a change of the users waiting as it was.
 *
 * @throws {Error} a value of the run breaks its rule
 */
export function domainCheckKept(check: DomainCheck): Statement {
  const { ran_at, by, run, pieces } = v.parse(DOMAIN_CHECK, check);
  const row = { id: 1, ran_at, ran_by: by, run, pieces: JSON.stringify(pieces) };
  const replaced = Object.fromEntries(REPLACED.map((column) => [column.name, fragment`excluded.${fragment.identifier(column.name)}`]));

  return built(BUILD.insert(domainCheck).values(row).onConflictDoUpdate({ target: domainCheck.id, set: replaced }));
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
 * Build the statement that remembers the users changed when a list replaces the stored logins. It goes before that replacement in a batch, since it compares the list with the logins still stored.
 * It writes only on an install that keeps a run, for a list that adds a login, drops one, or has another first login. Another order behind the same first login is no change.
 *
 * @param logins - the logins that replace the stored ones
 * @param at - the moment of the change
 */
export function usersReplaced(logins: readonly string[], at: number): Statement {
  const stored = fragment`json_each(${settings.value}, '$.logins')`;
  const given = fragment`json_each(${JSON.stringify(logins)})`;
  const dropped = fragment`EXISTS (SELECT 1 FROM ${stored} AS was WHERE was.value NOT IN (SELECT value FROM ${given}))`;
  const added = fragment`EXISTS (SELECT 1 FROM ${given} AS now WHERE now.value NOT IN (SELECT value FROM ${stored}))`;
  const moved = fragment`json_extract(${settings.value}, '$.logins[0]') IS NOT ${logins[0] ?? null}`;
  const differs = fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1 AND (${dropped} OR ${added} OR ${moved}))`;

  return built(BUILD.update(domainCheck).set({ users_changed_at: at }).where(and(eq(domainCheck.id, 1), differs)));
}

/** The mark of a change of the users, set anew: later than the moment given and than any mark before it, so whoever holds an earlier mark can tell that something happened since. */
function laterMark(at: number): ReturnType<typeof fragment> {
  return fragment`max(coalesce(${domainCheck.users_changed_at}, 0) + 1, ${v.parse(MOMENT, at)})`;
}

/**
 * Build the statement that marks the users as waiting before a try to carry them to the domain, with a mark later than every one before it. It writes only on an install that keeps a run.
 *
 * @param at - the moment of the try
 */
export function usersClaimed(at: number): Statement {
  return built(BUILD.update(domainCheck).set({ users_changed_at: laterMark(at) }).where(eq(domainCheck.id, 1)));
}

/**
 * Build the statement that settles a change of the users after a try to carry them to the domain. The mark goes only while the stored logins are exactly the list that was carried, in that order, and no mark was set since the try began.
 * Otherwise a later mark is set: a list carried while the users changed again, or while another try wrote the domain, never leaves the change forgotten.
 *
 * @param carried - what the try came to
 * @param at - the moment a mark is set anew with
 */
export function usersCarried(carried: CarriedUsers, at: number): Statement {
  if (carried.logins === null) return usersClaimed(at);

  const same = fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1 AND json_extract(${settings.value}, '$.logins') = json(${JSON.stringify(carried.logins)}))`;
  const untouched = fragment`(${domainCheck.users_changed_at} IS NULL OR ${domainCheck.users_changed_at} <= ${v.parse(MOMENT, carried.since)})`;

  return built(BUILD.update(domainCheck).set({ users_changed_at: fragment`CASE WHEN ${same} AND ${untouched} THEN NULL ELSE ${laterMark(at)} END` }).where(eq(domainCheck.id, 1)));
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
