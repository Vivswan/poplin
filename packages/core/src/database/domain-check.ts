// The statements that keep and read the last check or repair of the domain: one row, replaced by each run, which also remembers that the users changed and the change has not reached the domain.
// It remembers the same, in `rules_changed_at` and by the same rule, of the settings the domain's rules are written from.
//
//   users_changed_at   above zero   a change of the users waits, under this mark
//                      below zero   none waits; its size is the last mark there was
//                      NULL         none ever waited
//
// A mark is always later than every mark before it, the settled ones too, so a try that began under an earlier mark can never take a later one for its own.

import { and, eq, sql as fragment, gt } from "drizzle-orm";
import * as v from "valibot";

import { type CarriedRules, type CarriedUsers, DOMAIN_CHECK, type DomainCheck, type RememberedCheck } from "../records/domain-check";
import { MOMENT } from "../records/fields";
import { RULE_SETTINGS, type RuleSettings } from "../records/settings";
import type { Statement, StatementResult } from "./driver";
import { domainCheck, settings } from "./schema";
import { BUILD, built, CHANGED } from "./statements";

/** The size of the mark the row holds, waiting or settled: zero where none was ever set. */
const LAST_MARK = fragment`abs(coalesce(${domainCheck.users_changed_at}, 0))`;

/** The size of the mark the row holds of the settings of the domain's rules, waiting or settled: zero where none was ever set. */
const LAST_RULES_MARK = fragment`abs(coalesce(${domainCheck.rules_changed_at}, 0))`;

/** The columns a new run replaces in the kept row. */
const REPLACED = [domainCheck.ran_at, domainCheck.ran_by, domainCheck.run, domainCheck.pieces] as const;

/** The mark of a change of the users, set anew: no earlier than the moment given and later than any mark before it, so whoever holds an earlier mark can tell that something happened since. */
function laterMark(at: number): ReturnType<typeof fragment> {
  return fragment`max(${LAST_MARK} + 1, ${v.parse(MOMENT, at)})`;
}

/** The mark of a change of the settings of the domain's rules, set anew as `laterMark` sets the one of the users. */
function laterRulesMark(at: number): ReturnType<typeof fragment> {
  return fragment`max(${LAST_RULES_MARK} + 1, ${v.parse(MOMENT, at)})`;
}

/** Whether the stored settings hold exactly these values under their keys. */
function storedRules(rules: Partial<RuleSettings>): ReturnType<typeof fragment> {
  const given = JSON.stringify(rules);
  const terms = RULE_SETTINGS.filter((key) => rules[key] !== undefined).map((key) => fragment`json_extract(${settings.value}, ${`$.${key}`}) IS json_extract(${given}, ${`$.${key}`})`);

  return fragment`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.id} = 1 AND ${fragment.join([fragment`1`, ...terms], fragment` AND `)})`;
}

/**
 * Build the statement that reads the kept run.
 *
 * @returns one `SELECT` of the one row, its pieces as JSON text
 */
export function domainCheckAsked(): Statement {
  const { ran_at, ran_by, run, pieces, users_changed_at, rules_changed_at } = domainCheck;
  const columns = { ran_at, ran_by, run, pieces, users_changed_at, rules_changed_at };

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
  return built(BUILD.update(domainCheck).set({ users_changed_at: laterMark(at) }).where(and(eq(domainCheck.id, 1), CHANGED)));
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

  return built(BUILD.update(domainCheck).set({ users_changed_at: laterMark(at) }).where(and(eq(domainCheck.id, 1), differs)));
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
  const untouched = fragment`${LAST_MARK} <= ${v.parse(MOMENT, carried.since)}`;
  // A settled mark keeps its size, below zero: the next one is later than it.
  const settled = fragment`-abs(${domainCheck.users_changed_at})`;

  return built(BUILD.update(domainCheck).set({ users_changed_at: fragment`CASE WHEN ${same} AND ${untouched} THEN ${settled} ELSE ${laterMark(at)} END` }).where(eq(domainCheck.id, 1)));
}

/**
 * Build the statement that remembers a setting the domain's rules are written from changed. It goes before the change in a batch, since it compares the new values with the ones still stored.
 * It writes only on an install that keeps a run, and only where a value differs.
 *
 * @param changes - the settings a change names; the ones no rule is written from are not read
 * @param at - the moment of the change
 * @returns the statement, or `undefined` for a change that names no such setting
 */
export function rulesReplaced(changes: Partial<RuleSettings>, at: number): Statement | undefined {
  if (RULE_SETTINGS.every((key) => changes[key] === undefined)) return undefined;

  return built(BUILD.update(domainCheck).set({ rules_changed_at: laterRulesMark(at) }).where(and(eq(domainCheck.id, 1), fragment`NOT ${storedRules(changes)}`)));
}

/**
 * Build the statement that begins a try to carry the settings of the domain's rules to the domain: a change that waits gets a mark later than every one before it.
 * It writes only where a change waits, so a try sets no mark of its own: one the domain refuses leaves waiting what waited, and nothing else.
 *
 * @param at - the moment of the try
 */
export function rulesClaimed(at: number): Statement {
  return built(BUILD.update(domainCheck).set({ rules_changed_at: laterRulesMark(at) }).where(and(eq(domainCheck.id, 1), gt(domainCheck.rules_changed_at, 0))));
}

/**
 * Build the statement that settles a change of the settings of the domain's rules after a try to carry them to the domain, as `usersCarried` settles the users.
 * The mark is settled only while the stored values are the ones carried and no mark was set since the try began.
 * Otherwise a later mark is set, also where another try has settled meanwhile: values written after that try's leave the rules behind the settings.
 *
 * @param carried - what the try came to
 * @param at - the moment a mark is set anew with
 */
export function rulesCarried(carried: CarriedRules, at: number): Statement {
  // A try whose outcome is unknown leaves the change waiting, also where none waited when it began.
  if (carried.rules === null) return built(BUILD.update(domainCheck).set({ rules_changed_at: laterRulesMark(at) }).where(eq(domainCheck.id, 1)));

  const untouched = fragment`${LAST_RULES_MARK} <= ${v.parse(MOMENT, carried.since)}`;
  const settled = fragment`-abs(${domainCheck.rules_changed_at})`;
  const mark = fragment`CASE WHEN ${storedRules(carried.rules)} AND ${untouched} THEN ${settled} ELSE ${laterRulesMark(at)} END`;

  return built(BUILD.update(domainCheck).set({ rules_changed_at: mark }).where(eq(domainCheck.id, 1)));
}

/**
 * Read the mark a change waits under out of a stored column, of the users or of the settings of the domain's rules.
 *
 * @returns the mark, or `undefined` where none waits: a column that was never set, or one that holds a settled mark
 */
export function waitingMark(stored: unknown): number | undefined {
  return typeof stored === "number" && stored > 0 ? stored : undefined;
}

/**
 * Read the kept run out of what `domainCheckAsked` answered.
 *
 * @returns the run, the mark a change of the users waits under, and the same of the settings of the domain's rules, or `undefined` for no row and for a row that is no run
 */
export function domainCheckIn(result: StatementResult | undefined): RememberedCheck | undefined {
  const row = result?.rows[0];
  if (row === undefined || typeof row.pieces !== "string") return undefined;

  const check = v.safeParse(DOMAIN_CHECK, { ran_at: row.ran_at, by: row.ran_by, run: row.run, pieces: JSON.parse(row.pieces) });
  if (!check.success) return undefined;

  return { ...check.output, users_changed_at: waitingMark(row.users_changed_at) ?? null, rules_changed_at: waitingMark(row.rules_changed_at) ?? null };
}
