// The statements that search the audit log, count it, find where a part of it ends and trim its oldest end, and what each answers. Each reads no further than it is told, since the provider charges every row a statement reads.

import { and, asc, count, desc, eq, getTableColumns, gt, inArray, isNull, lt, min, type SQL, sql as fragment, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import * as v from "valibot";

import { type AuditAction, auditFromRow, HISTORY_KEPT_MS } from "../records/audit";
import { COUNT, POSITIVE, SITE_ID, SITE_NAME } from "../records/fields";
import { TITLE } from "../records/site";
import type { SiteId } from "../sites/ids";
import { AUDIT_WINDOW, type AuditCount, type AuditCountQuery, type AuditPartQuery, type AuditQuery, type AuditSearch, type NamedAuditEntry } from "./database";
import type { Statement, StatementResult } from "./driver";
import { audit, earlierIds, sites, tokens } from "./schema";
import { holding } from "./site-statements";
import { BUILD, built, written } from "./statements";

/** What a count of the audit log answers: whether it read the log to its oldest entry, as 1 or 0, and how many of the entries it read the narrowing keeps. */
const AUDIT_COUNT_ROW = v.object({ whole: v.picklist([0, 1]), found: COUNT });

/** The oldest and the newest `seq` of the log, as the statement of its ends answers them: both `null` for an empty log. */
const AUDIT_ENDS_ROW = v.object({ oldest: v.nullable(POSITIVE), newest: v.nullable(POSITIVE) });

/** The most entries one trim of the log removes. The sweep trims up to 96 times a day, and the provider counts each entry removed as a row written. */
const MOST_ENTRIES_TRIMMED = 100;

/** The oldest `seq` of the log. */
const OLDEST_SEQ = fragment`(SELECT min(${audit.seq}) FROM ${audit})`;

/** The newest `seq` of the log. */
const NEWEST_SEQ = fragment`(SELECT max(${audit.seq}) FROM ${audit})`;

/** True once anybody has logged in: the log holds a login, or lost its first entry, which only a log that held a login does. The kind stands in the text itself, since the engine reads the index of the logins only for a kind it can see there. */
const EVER_LOGGED_IN = fragment`(EXISTS (SELECT 1 FROM ${audit} WHERE ${audit.action} = 'login') OR coalesce(${OLDEST_SEQ} > 1, 0))`;

/** The `sites` table as `held`: the site that has the id an entry holds. */
const HELD = alias(sites, "held");

/** The `sites` table as `moved`: the site that gave that id up at a new link, found by the folder it keeps. It is looked for only where no site has the id. */
const MOVED = alias(sites, "moved");

/** An entry's own columns, and what it names as it is now: the site's id, name and listed title, each from the one of the two sites that was found, and the note of the token that did it. */
const NAMED_COLUMNS = {
  ...getTableColumns(audit),
  now_id: fragment<string | null>`coalesce(${HELD.id}, ${MOVED.id})`.as("now_id"),
  now_name: fragment<string | null>`coalesce(${HELD.name}, ${MOVED.name})`.as("now_name"),
  now_title: fragment<string | null>`coalesce(${HELD.title}, ${HELD.page_title}, ${MOVED.title}, ${MOVED.page_title})`.as("now_title"),
  token_note: fragment<string | null>`${tokens.note}`.as("token_note"),
};

/** What a named entry's row holds beside the entry. */
const NAMED_ROW = v.object({ now_id: v.nullable(SITE_ID), now_name: v.nullable(SITE_NAME), now_title: v.nullable(TITLE), token_note: v.nullable(v.string()) });

/** How a page of the log is read. */
interface Page {
  /** The condition its entries meet. */
  readonly kept: SQL | undefined;

  /** Whether the newest entry is first. */
  readonly newestFirst: boolean;

  /** The most entries it holds. */
  readonly limit: number;

  /** Whether each entry is read with what it names as it is now. */
  readonly named: boolean;
}

/**
 * Build the statement that reads a page of the log.
 *
 * A named page joins each entry to the site that has its id, else to the site that gave the id up, and to the token that did it: each by a key. A site may hold an id another gave up, and the holder is the one named.
 */
function pageAsked({ kept, newestFirst, limit, named }: Page): Statement {
  const order = newestFirst ? desc(audit.seq) : asc(audit.seq);
  if (!named) return built(BUILD.select().from(audit).where(kept).orderBy(order).limit(limit));

  const entries = BUILD.select(NAMED_COLUMNS)
    .from(audit)
    .leftJoin(HELD, eq(HELD.id, audit.site_id))
    .leftJoin(earlierIds, and(eq(earlierIds.id, audit.site_id), isNull(HELD.id)))
    .leftJoin(MOVED, eq(MOVED.folder, earlierIds.folder))
    .leftJoin(tokens, and(eq(tokens.id, audit.actor), fragment`${tokens.note} <> ''`));

  return built(entries.where(kept).orderBy(order).limit(limit));
}

/** The condition an entry of the audit log meets to be of some actions; `undefined` when none is asked. The actions are named one by one: a list read from JSON is charged as rows of its own. */
function auditAmong(actions: readonly AuditAction[] | undefined): SQL | undefined {
  return actions === undefined ? undefined : inArray(audit.action, [...actions]);
}

/**
 * The condition an entry of the audit log meets to be about a site a text finds; `undefined` when no text is asked.
 *
 * The text finds a site whose name then held it, and a site that holds it now in its name, its listed title, or its public name, as a listing of the sites finds one: the entries of such a site from before a new link are among them.
 * The sites that hold the text now are read once for the statement, not once an entry.
 */
function auditAbout(site: string | undefined): SQL | undefined {
  if (site === undefined) return undefined;

  const now = BUILD.select({ id: sites.id }).from(sites).where(holding(site));
  const before = BUILD.select({ id: earlierIds.id }).from(earlierIds).innerJoin(sites, eq(sites.folder, earlierIds.folder)).where(holding(site));

  return fragment`(instr(${audit.site_name}, lower(${site})) > 0 OR ${audit.site_id} IN ${now} OR ${audit.site_id} IN ${before})`;
}

/**
 * The condition an entry of the audit log meets to be of the one site an id names; `undefined` when no id is asked.
 *
 * A site keeps its folder through every new link: the id names the site that has it now or had it once, and the entries are those that hold any id of that site. An id of no site keeps the entries that hold it.
 * The site and its earlier ids are read once for the statement, each by a key.
 */
function auditOf(id: SiteId | undefined): SQL | undefined {
  if (id === undefined) return undefined;

  const folder = fragment`coalesce((SELECT ${sites.folder} FROM ${sites} WHERE ${sites.id} = ${id}), (SELECT ${earlierIds.folder} FROM ${earlierIds} WHERE ${earlierIds.id} = ${id}))`;
  const now = BUILD.select({ id: sites.id }).from(sites).where(eq(sites.folder, folder));
  const before = BUILD.select({ id: earlierIds.id }).from(earlierIds).where(eq(earlierIds.folder, folder));

  return fragment`(${audit.site_id} = ${id} OR ${audit.site_id} IN ${now} OR ${audit.site_id} IN ${before})`;
}

/** Build the statement that reads whether anybody has ever logged in, as `found`, 1 or 0: one row read once somebody has, and two before. */
export function everLoggedInAsked(): Statement {
  return written(fragment`SELECT ${EVER_LOGGED_IN} AS found`);
}

/**
 * Build the statement that removes the oldest entries of the log written over 90 days before a moment: no more than `MOST_ENTRIES_TRIMMED` of them, never the newest entry, and none past the first entry that is kept.
 *
 * So the log loses one run of entries from its oldest end, and a count from its two ends stays the count of its rows. A log nobody has logged in to loses nothing: its first entry is what says so.
 * With nothing to remove it reads the log's two ends, its oldest entry, and whether anybody logged in, and writes no row.
 */
export function auditTrimmed(now: number): Statement {
  const ends = fragment`(SELECT ${OLDEST_SEQ} AS oldest, ${NEWEST_SEQ} AS newest) AS ends`;
  const firstKept = fragment`(SELECT ${audit.seq} FROM ${audit} WHERE ${audit.at} >= ${now - HISTORY_KEPT_MS} AND ${audit.seq} < ends.oldest + ${MOST_ENTRIES_TRIMMED} ORDER BY ${audit.seq} LIMIT 1)`;
  const bound = fragment`(SELECT min(ends.oldest + ${MOST_ENTRIES_TRIMMED}, coalesce(${firstKept}, ends.newest)) FROM ${ends})`;

  return written(fragment`DELETE FROM ${audit} WHERE ${audit.seq} < ${bound} AND ${EVER_LOGGED_IN}`);
}

/** Build the statement that reads the oldest and the newest `seq` of the log: two rows read, whatever the log's length. */
export function auditEndsAsked(): Statement {
  return written(fragment`SELECT (SELECT min(${audit.seq}) FROM ${audit}) AS oldest, (SELECT max(${audit.seq}) FROM ${audit}) AS newest`);
}

/**
 * Build the statement that reads one page of the log, any entry.
 *
 * @param start - where a page with no page before it starts: before the oldest entry or past the newest
 * @param named - whether each entry is read with what it names as it is now
 */
export function auditListAsked(query: AuditQuery, start: number, named: boolean): Statement {
  const newestFirst = query.dir !== "asc";
  const from = query.after ?? start;

  return pageAsked({ kept: newestFirst ? lt(audit.seq, from) : gt(audit.seq, from), newestFirst, limit: query.limit, named });
}

/**
 * Build the statement that reads one page of the entries a narrowing keeps, among the `AUDIT_WINDOW` entries behind the place it starts from.
 *
 * A reading with no page before it starts from the log's own end, which the statement asks the log for.
 *
 * @param named - whether each entry is read with what it names as it is now
 */
export function auditSearchAsked(query: AuditSearch, named: boolean): Statement {
  const newestFirst = query.dir !== "asc";
  const end = newestFirst ? fragment`(SELECT max(${audit.seq}) + 1 FROM ${audit})` : fragment`(SELECT min(${audit.seq}) - 1 FROM ${audit})`;
  const start = query.after === undefined ? end : fragment`${query.after}`;
  const within = newestFirst
    ? fragment`${audit.seq} < ${start} AND ${audit.seq} >= ${start} - ${AUDIT_WINDOW}`
    : fragment`${audit.seq} > ${start} AND ${audit.seq} <= ${start} + ${AUDIT_WINDOW}`;
  const kept = and(within, auditAmong(query.actions), auditAbout(query.site), auditOf(query.of));

  return pageAsked({ kept, newestFirst, limit: query.limit, named });
}

/** Read what a statement of a named page answered: each entry, and what it names as it is now. */
export function namedAuditIn(result: StatementResult | undefined): readonly NamedAuditEntry[] {
  return (result?.rows ?? []).map((row) => {
    const { now_id: id, now_name: name, now_title: title, token_note: tokenNote } = v.parse(NAMED_ROW, row);

    return { entry: auditFromRow(row), site: id === null || name === null ? null : { id, name, title }, tokenNote };
  });
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
 * Build the statement that counts the entries a narrowing keeps among the newest `most` of the log. An entry's `seq` is its place: the log is added to one `seq` after the other, and loses entries at its oldest end alone.
 *
 * With no narrowing the count is read off the log's two ends, the newest `seq` less the oldest and one: two rows, whatever the log's length. No `seq` is left out between them.
 *
 * @throws {RangeError} `most` is not a whole number of at least 1
 */
export function auditCountAsked(query: AuditCountQuery): Statement {
  if (!Number.isSafeInteger(query.most) || query.most < 1) throw new RangeError(`a count reads at least 1 entry, not ${query.most}`);

  const oldestSeq = fragment`(SELECT min(${audit.seq}) FROM ${audit})`;

  if (query.actions === undefined && query.site === undefined && query.of === undefined) {
    const ends = fragment`(SELECT ${oldestSeq} AS oldest, (SELECT max(${audit.seq}) FROM ${audit}) AS newest) AS ends`;
    const held = fragment`ends.newest - ends.oldest + 1`;

    return written(fragment`SELECT coalesce(${held} <= ${query.most}, 1) AS whole, coalesce(min(${held}, ${query.most}), 0) AS found FROM ${ends}`);
  }

  // A text or an id finds a site among the sites, and the engine charges that look once an entry inside a reading that is counted from: under either the entries are counted where they are narrowed, by their place in the log.
  if (query.site !== undefined || query.of !== undefined) {
    const newestSeq = fragment`(SELECT max(${audit.seq}) FROM ${audit})`;
    const kept = and(fragment`${audit.seq} > ${newestSeq} - ${query.most}`, auditAmong(query.actions), auditAbout(query.site), auditOf(query.of));
    const found = BUILD.select({ found: count().as("found") }).from(audit).where(kept);

    return written(fragment`SELECT coalesce(${newestSeq} - ${query.most} < ${oldestSeq}, 1) AS whole, ${found} AS found`);
  }

  const kept = auditAmong(query.actions) ?? fragment`1`;
  const newest = BUILD.select({ seq: audit.seq, kept: fragment<number>`${kept}`.as("kept") }).from(audit).orderBy(desc(audit.seq)).limit(query.most).as("newest");

  return built(BUILD.select({ whole: fragment`coalesce(${min(newest.seq)} <= ${oldestSeq}, 1)`.as("whole"), found: fragment`coalesce(${sum(newest.kept)}, 0)`.as("found") }).from(newest));
}

/** Read what the count's statement answered. A count that did not reach the log's oldest entry is the least it can be: the log goes on behind what was read. */
export function auditCountIn(result: StatementResult | undefined): AuditCount {
  const { whole, found } = v.parse(AUDIT_COUNT_ROW, result?.rows[0]);

  return { count: found, whole: whole === 1 };
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
