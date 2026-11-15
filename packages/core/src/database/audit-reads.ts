// The statements that count the audit log and find where a part of it ends, and what each answers. Both read no further than they are told, since the provider charges every row a statement reads.

import { and, count, desc, inArray, lt, type SQL, sql as fragment, sum } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import * as v from "valibot";

import type { AuditAction } from "../records/audit";
import { COUNT, POSITIVE } from "../records/fields";
import type { AuditCount, AuditCountQuery, AuditPartQuery } from "./database";
import type { SqlValue, Statement, StatementResult } from "./driver";
import { audit } from "./schema";

/** Where the statements are built from the declared schema. None is run here: each goes to the driver, in a batch. */
const BUILD = drizzle(() => Promise.reject(new Error("a statement is run by the driver, in a batch")));

/** What a count of the audit log answers: the entries it read, and those among them the narrowing keeps. */
const AUDIT_COUNT_ROW = v.object({ seen: COUNT, found: COUNT });

/** A built statement as the driver takes it. */
function built(query: { toSQL(): { sql: string; params: unknown[] } }): Statement {
  const { sql: text, params } = query.toSQL();

  return { sql: text, params: params as SqlValue[] };
}

/** The condition an entry of the audit log meets to be of some actions; `undefined` when none is asked. The actions are named one by one: a list read from JSON is charged as rows of its own. */
export function auditAmong(actions: readonly AuditAction[] | undefined): SQL | undefined {
  return actions === undefined ? undefined : inArray(audit.action, [...actions]);
}

/** The condition an entry of the audit log meets to be about a site whose name then held a text; `undefined` when no text is asked. */
export function auditAbout(site: string | undefined): SQL | undefined {
  return site === undefined ? undefined : fragment`instr(${audit.site_name}, ${site}) > 0`;
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

  const kept = and(lt(audit.seq, query.after ?? start), auditAmong(query.actions), auditAbout(query.site));

  return built(BUILD.select({ seq: audit.seq }).from(audit).where(kept).orderBy(desc(audit.seq)).limit(2).offset(query.entries - 1));
}

/** Read what the part's statement answered: the `seq` of the part's last entry when an entry lies behind it, which says that the log goes on. */
export function auditPartEndIn(result: StatementResult | undefined): number | undefined {
  const [last, beyond] = result?.rows ?? [];

  return last === undefined || beyond === undefined ? undefined : v.parse(POSITIVE, last.seq);
}
