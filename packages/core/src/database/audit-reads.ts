// The statements that search the audit log, count it and find where a part of it ends, and what each answers. Each reads no further than it is told, since the provider charges every row a statement reads.

import { and, asc, count, desc, inArray, lt, type SQL, sql as fragment, sum } from "drizzle-orm";
import * as v from "valibot";

import type { AuditAction } from "../records/audit";
import { COUNT, POSITIVE } from "../records/fields";
import { AUDIT_WINDOW, type AuditCount, type AuditCountQuery, type AuditPartQuery, type AuditSearch } from "./database";
import type { Statement, StatementResult } from "./driver";
import { audit } from "./schema";
import { BUILD, built, written } from "./statements";

/** What a count of the audit log answers: the entries it read, and those among them the narrowing keeps. */
const AUDIT_COUNT_ROW = v.object({ seen: COUNT, found: COUNT });

/** The oldest and the newest `seq` of the log, as the statement of its ends answers them: both `null` for an empty log. */
const AUDIT_ENDS_ROW = v.object({ oldest: v.nullable(POSITIVE), newest: v.nullable(POSITIVE) });

/** The condition an entry of the audit log meets to be of some actions; `undefined` when none is asked. The actions are named one by one: a list read from JSON is charged as rows of its own. */
function auditAmong(actions: readonly AuditAction[] | undefined): SQL | undefined {
  return actions === undefined ? undefined : inArray(audit.action, [...actions]);
}

/** The condition an entry of the audit log meets to be about a site whose name then held a text; `undefined` when no text is asked. */
function auditAbout(site: string | undefined): SQL | undefined {
  return site === undefined ? undefined : fragment`instr(${audit.site_name}, ${site}) > 0`;
}

/** Build the statement that reads the oldest and the newest `seq` of the log: two rows read, whatever the log's length. */
export function auditEndsAsked(): Statement {
  return written(fragment`SELECT (SELECT min(${audit.seq}) FROM ${audit}) AS oldest, (SELECT max(${audit.seq}) FROM ${audit}) AS newest`);
}

/**
 * Build the statement that reads one page of the entries a narrowing keeps, among the `AUDIT_WINDOW` entries behind the place it starts from.
 *
 * A reading with no page before it starts from the log's own end, which the statement asks the log for.
 */
export function auditSearchAsked(query: AuditSearch): Statement {
  const newestFirst = query.dir !== "asc";
  const end = newestFirst ? fragment`(SELECT max(${audit.seq}) + 1 FROM ${audit})` : fragment`(SELECT min(${audit.seq}) - 1 FROM ${audit})`;
  const start = query.after === undefined ? end : fragment`${query.after}`;
  const within = newestFirst
    ? fragment`${audit.seq} < ${start} AND ${audit.seq} >= ${start} - ${AUDIT_WINDOW}`
    : fragment`${audit.seq} > ${start} AND ${audit.seq} <= ${start} + ${AUDIT_WINDOW}`;
  const kept = and(within, auditAmong(query.actions), auditAbout(query.site));

  return built(BUILD.select().from(audit).where(kept).orderBy(newestFirst ? desc(audit.seq) : asc(audit.seq)).limit(query.limit));
}

/**
 * Read where a narrowed reading that came back short stopped, from what the statement of the log's ends answered.
 *
 * @returns the last `seq` its window took in, which the next reading goes on after; `undefined` when the window reached the log's end, so nothing lies behind it
 */
export function auditStopIn(ends: StatementResult | undefined, query: AuditSearch): number | undefined {
  const { oldest, newest } = v.parse(AUDIT_ENDS_ROW, ends?.rows[0]);
  if (oldest === null || newest === null) return undefined;

  if (query.dir === "asc") {
    const last = (query.after ?? oldest - 1) + AUDIT_WINDOW;

    return last < newest ? last : undefined;
  }

  const last = (query.after ?? newest + 1) - AUDIT_WINDOW;

  return last > oldest ? last : undefined;
}

/**
 * Build the statement that counts the entries a narrowing keeps among the newest `most` of the log.
 *
 * @throws {RangeError} `most` is not a whole number of at least 1
 */
export function auditCountAsked(query: AuditCountQuery): Statement {
  if (!Number.isSafeInteger(query.most) || query.most < 1) throw new RangeError(`a count reads at least 1 entry, not ${query.most}`);

  const kept = and(auditAmong(query.actions), auditAbout(query.site)) ?? fragment`1`;
  const newest = BUILD.select({ kept: fragment<number>`${kept}`.as("kept") }).from(audit).orderBy(desc(audit.seq)).limit(query.most).as("newest");

  return built(BUILD.select({ seen: count().as("seen"), found: fragment`coalesce(${sum(newest.kept)}, 0)`.as("found") }).from(newest));
}

/** Read what the count's statement answered. A log of as many entries as were read may go on behind them, so the count is then the least it can be. */
export function auditCountIn(result: StatementResult | undefined, most: number): AuditCount {
  const { seen, found } = v.parse(AUDIT_COUNT_ROW, result?.rows[0]);

  return { count: found, whole: seen < most };
}

/**
 * Build the statement that reads the last entry of a part of the log and the entry behind it.
 *
 * @param start - where a part with no part before it starts: past the newest entry
 * @throws {RangeError} `entries` is not a whole number of at least 1
 */
export function auditPartEndAsked(query: AuditPartQuery, start: number): Statement {
  if (!Number.isSafeInteger(query.entries) || query.entries < 1) throw new RangeError(`a part of the log holds at least 1 entry, not ${query.entries}`);

  return built(BUILD.select({ seq: audit.seq }).from(audit).where(lt(audit.seq, query.after ?? start)).orderBy(desc(audit.seq)).limit(2).offset(query.entries - 1));
}

/** Read what the part's statement answered: the `seq` of the part's last entry when an entry lies behind it, which says that the log goes on. */
export function auditPartEndIn(result: StatementResult | undefined): number | undefined {
  const [last, beyond] = result?.rows ?? [];

  return last === undefined || beyond === undefined ? undefined : v.parse(POSITIVE, last.seq);
}
